-- 0028: Track 2 (affiliate) support in credit_referral_commission.
--
-- Repeat-order affiliate commission has no referrals row (the row qualifies
-- exactly once for Track 1), so the function now also accepts a direct
-- p_referrer_id (with p_referral_id nullable). It additionally accepts an
-- optional p_flag_reason: velocity-fraud flags computed by the caller force
-- status 'pending_review' (still credited — soft flag, never a hard block).
-- All cap/lock/credit semantics are otherwise unchanged from 0024.

-- NOTE: the signature changes (new trailing params), and Postgres would
-- otherwise keep the old 4-arg version as an ambiguous overload — drop it.
drop function if exists public.credit_referral_commission(uuid, uuid, int, numeric);

create or replace function public.credit_referral_commission(
  p_referral_id uuid,
  p_order_id uuid,
  p_raw_commission_halala int,
  p_review_threshold_pct numeric default 0.6,
  p_referrer_id uuid default null,
  p_flag_reason text default null
) returns jsonb
language plpgsql
as $$
declare
  v_referrer_id uuid;
  v_active boolean;
  v_cap int;
  v_rolling int;
  v_remaining int;
  v_actual int;
  v_status text;
begin
  if p_referral_id is not null then
    select referrer_id into v_referrer_id
      from public.referrals where id = p_referral_id;
  elsif p_referrer_id is not null then
    v_referrer_id := p_referrer_id;
  end if;
  if v_referrer_id is null then
    return jsonb_build_object(
      'status', 'referral_not_found',
      'credited_halala', 0,
      'flagged', false
    );
  end if;

  select is_active, monthly_cap_halala into v_active, v_cap
    from public.referral_settings
    where id = '00000000-0000-0000-0000-000000000001';
  if not found or not v_active then
    return jsonb_build_object(
      'status', 'program_inactive',
      'credited_halala', 0,
      'flagged', false
    );
  end if;

  -- Serialize concurrent credits for THIS referrer only; other referrers
  -- hash to different lock keys and proceed in parallel.
  perform pg_advisory_xact_lock(hashtext(v_referrer_id::text));

  -- Rolling 30-day window (no calendar-month reset exploit).
  select coalesce(sum(amount_halala), 0) into v_rolling
    from public.referral_rewards
    where referrer_id = v_referrer_id
      and reward_type = 'commission'
      and created_at >= now() - interval '30 days';

  v_remaining := greatest(0, v_cap - v_rolling);
  v_actual := least(p_raw_commission_halala, v_remaining);

  if v_actual <= 0 then
    return jsonb_build_object(
      'status', 'cap_reached',
      'credited_halala', 0,
      'rolling_total_halala', v_rolling,
      'cap_halala', v_cap,
      'flagged', false
    );
  end if;

  -- Soft review flag: still credited (immediately spendable in-app), but
  -- marked for a manual check; withdrawal eligibility excludes flagged rows.
  if p_flag_reason is not null
    or (v_rolling + v_actual) >= (v_cap * p_review_threshold_pct) then
    v_status := 'pending_review';
  else
    v_status := 'confirmed';
  end if;

  -- Reuse the existing atomic wallet credit (same pattern as before).
  perform public.credit_wallet(
    v_referrer_id,
    v_actual,
    format('Commission from referral order (%s)', p_order_id),
    'commission',
    p_referral_id
  );

  insert into public.referral_rewards
    (referral_id, referrer_id, reward_type, amount_halala, status,
     available_for_withdrawal_at, metadata)
  values
    (p_referral_id, v_referrer_id, 'commission', v_actual, v_status,
     now() + interval '7 days',
     jsonb_build_object('order_id', p_order_id, 'raw_commission_halala', p_raw_commission_halala,
                        'flags', coalesce(p_flag_reason, '')));

  return jsonb_build_object(
    'status', 'credited',
    'credited_halala', v_actual,
    'rolling_total_halala', v_rolling + v_actual,
    'cap_halala', v_cap,
    'flagged', v_status = 'pending_review'
  );
end;
$$;

revoke execute on function public.credit_referral_commission(uuid, uuid, int, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.credit_referral_commission(uuid, uuid, int, numeric, uuid, text) to service_role;
