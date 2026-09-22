-- 0022: Referral commission cap fix + new business terms.
--
-- Fixes:
--  1. The monthly cap was accidentally platform-wide (the old server code summed
--     referral_rewards across ALL referrers). Commissions now carry a denormalized
--     referrer_id and the cap is enforced per-referrer inside one atomic function.
--  2. The old check-then-credit in application code raced under concurrency.
--     credit_referral_commission() serializes per-referrer with an advisory lock.
--  3. The old cap reset on calendar-month boundaries (exploitable across month
--     end). The new cap uses a rolling 30-day window.
--
-- Business terms:
--  - first_purchase_percent 10 -> 5 (commission to the referrer).
--  - New referred_discount_percent = 5 (discount to the referred friend's first
--    qualifying order, applied automatically at checkout).
--  - monthly_cap_halala raised to 500000 (5,000 ETB). Reasoning: products run
--    ~1,000-7,000 ETB, so a representative qualifying order is ~3,500 ETB, which
--    at 5% pays ~175 ETB (17,500 halala) commission. A cap of 5,000 ETB covers
--    ~28 such referrals per rolling 30 days before the hard cap, with the soft
--    review flag firing at 60% (~3,000 ETB, ~17 referrals).
--  - Commission becomes spendable only after the referred order is delivered +
--    a buffer (available_at, set by release_available_commissions, run nightly).

-- ──────────────────────────────────────────────────────────────────────
-- 1. referral_rewards: referrer_id, status, available_at
-- ──────────────────────────────────────────────────────────────────────

alter table public.referral_rewards
  add column if not exists referrer_id uuid references public.profiles(id) on delete cascade;

-- Backfill from the parent referrals row (referral_id has ON DELETE CASCADE,
-- so every surviving row has a parent).
update public.referral_rewards rr
  set referrer_id = r.referrer_id
  from public.referrals r
  where r.id = rr.referral_id
    and rr.referrer_id is null;

alter table public.referral_rewards
  add column if not exists status text not null default 'confirmed'
    check (status in ('confirmed', 'pending_review'));

alter table public.referral_rewards
  add column if not exists available_at timestamptz;

create index if not exists idx_referral_rewards_referrer_created
  on public.referral_rewards (referrer_id, created_at)
  where reward_type = 'commission';

-- ──────────────────────────────────────────────────────────────────────
-- 2. referral_settings: new terms
-- ──────────────────────────────────────────────────────────────────────

alter table public.referral_settings
  add column if not exists referred_discount_percent int not null default 5;

alter table public.referral_settings
  alter column first_purchase_percent set default 5;

alter table public.referral_settings
  alter column monthly_cap_halala set default 500000;

update public.referral_settings
  set first_purchase_percent = 5,
      monthly_cap_halala = 500000,
      referred_discount_percent = 5,
      updated_at = now()
  where id = '00000000-0000-0000-0000-000000000001';

-- ──────────────────────────────────────────────────────────────────────
-- 3. orders.delivered_at (drives commission availability)
-- ──────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists delivered_at timestamptz;

-- Backfill already-delivered orders from the last write timestamp.
update public.orders
  set delivered_at = coalesce(updated_at, created_at)
  where status = 'delivered'
    and delivered_at is null;

create or replace function public.set_orders_delivered_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_delivered_at on public.orders;
create trigger trg_orders_delivered_at
  before update of status on public.orders
  for each row execute function public.set_orders_delivered_at();

-- ──────────────────────────────────────────────────────────────────────
-- 4. credit_referral_commission(): atomic per-referrer cap + credit
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.credit_referral_commission(
  p_referral_id uuid,
  p_order_id uuid,
  p_raw_commission_halala int,
  p_review_threshold_pct numeric default 0.6
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
  select referrer_id into v_referrer_id
    from public.referrals where id = p_referral_id;
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

  -- Soft review flag: still credited, but marked for a manual check before
  -- the amount becomes spendable/unlockable.
  if (v_rolling + v_actual) >= (v_cap * p_review_threshold_pct) then
    v_status := 'pending_review';
  else
    v_status := 'confirmed';
  end if;

  -- Reuse the existing atomic wallet credit (same pattern as the old code).
  perform public.credit_wallet(
    v_referrer_id,
    v_actual,
    format('Commission from referral order (%s)', p_order_id),
    'commission',
    p_referral_id
  );

  insert into public.referral_rewards
    (referral_id, referrer_id, reward_type, amount_halala, status, metadata)
  values
    (p_referral_id, v_referrer_id, 'commission', v_actual, v_status,
     jsonb_build_object('order_id', p_order_id, 'raw_commission_halala', p_raw_commission_halala));

  return jsonb_build_object(
    'status', 'credited',
    'credited_halala', v_actual,
    'rolling_total_halala', v_rolling + v_actual,
    'cap_halala', v_cap,
    'flagged', v_status = 'pending_review'
  );
end;
$$;

revoke execute on function public.credit_referral_commission(uuid, uuid, int, numeric) from public, anon, authenticated;
grant execute on function public.credit_referral_commission(uuid, uuid, int, numeric) to service_role;

-- ──────────────────────────────────────────────────────────────────────
-- 5. release_available_commissions(): delivery + buffer gate
-- ──────────────────────────────────────────────────────────────────────
-- Intended to run daily (wired into the existing nightly cron job).
-- Only 'confirmed' rows are released; 'pending_review' rows stay locked
-- until an admin reviews them and flips status to 'confirmed'.

create or replace function public.release_available_commissions(
  p_delay_days int default 4
) returns jsonb
language plpgsql
as $$
declare
  v_released int;
begin
  with released as (
    update public.referral_rewards rr
      set available_at = now()
      from public.orders o
      where rr.reward_type = 'commission'
        and rr.status = 'confirmed'
        and rr.available_at is null
        and rr.metadata->>'order_id' ~ '^[0-9a-fA-F-]{36}$'
        and o.id = (rr.metadata->>'order_id')::uuid
        and o.delivered_at is not null
        and o.delivered_at + (p_delay_days || ' days')::interval <= now()
        and not exists (
          select 1 from public.commission_reversals cr
          where cr.order_id = o.id
        )
      returning rr.id
  )
  select count(*) into v_released from released;

  return jsonb_build_object('released', v_released);
end;
$$;

revoke execute on function public.release_available_commissions(int) from public, anon, authenticated;
grant execute on function public.release_available_commissions(int) to service_role;
