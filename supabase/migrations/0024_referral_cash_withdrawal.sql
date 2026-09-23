-- 0024: Referral weekly cash withdrawal via Chapa Transfer API.
--
-- NOTE ON NUMBERING: the task spec asked for this as 0022, but 0022
-- (commission cap fix) and 0023 (terms acceptance) already exist, so this
-- ships as 0024. It covers both the cap engine (as specified) and payouts.
--
-- MODEL CHANGE vs 0022: commission is spendable in-app IMMEDIATELY on credit
-- (no delivery hold). The 7-day aging applies ONLY to cash-withdrawal
-- eligibility, tracked by the new available_for_withdrawal_at column. The
-- 0022 release machinery (release_available_commissions(),
-- trg_orders_delivered_at) is therefore dropped here; its columns
-- (referral_rewards.available_at, orders.delivered_at) are left in place,
-- dormant and harmless, to avoid destructive changes.
--
-- Business terms (re-affirmed idempotently for fresh installs):
--  - first_purchase_percent = 5, referred_discount_percent = 5.
--  - monthly_cap_halala = 500000 (5,000 ETB). Math: representative qualifying
--    order ~3,500 ETB (products run 1,000-7,000 ETB) pays 5% = ~175 ETB
--    (17,500 halala) commission, so 5,000 ETB covers ~28 such referrals per
--    rolling 30 days, with the soft review flag at 60% (~3,000 ETB).

-- ──────────────────────────────────────────────────────────────────────
-- 1. Re-affirm business terms on referral_settings
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
-- 2. Withdrawal aging column on referral_rewards (+ backfill)
-- ──────────────────────────────────────────────────────────────────────

alter table public.referral_rewards
  add column if not exists available_for_withdrawal_at timestamptz;

-- Existing commission rows age from when they were credited.
update public.referral_rewards
  set available_for_withdrawal_at = created_at + interval '7 days'
  where reward_type = 'commission'
    and available_for_withdrawal_at is null;

-- ──────────────────────────────────────────────────────────────────────
-- 3. credit_referral_commission(): same atomic per-referrer cap as 0022,
--    plus the 7-day withdrawal-aging timestamp on the inserted row.
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

  -- Soft review flag: still credited (immediately spendable in-app), but
  -- marked for a manual check; withdrawal eligibility excludes flagged rows.
  if (v_rolling + v_actual) >= (v_cap * p_review_threshold_pct) then
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
-- 4. Drop the superseded 0022 release machinery (see header note)
-- ──────────────────────────────────────────────────────────────────────

drop function if exists public.release_available_commissions(int);
drop trigger if exists trg_orders_delivered_at on public.orders;
drop function if exists public.set_orders_delivered_at();

-- ──────────────────────────────────────────────────────────────────────
-- 5. referrer_payout_accounts — one verified bank account per referrer
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.referrer_payout_accounts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  account_name  text not null,
  account_number text not null,
  bank_code     text not null,
  bank_name     text not NULL,
  verified      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint referrer_payout_accounts_one_per_profile unique (profile_id)
);

alter table public.referrer_payout_accounts enable row level security;

drop policy if exists "payout_accounts_service_role" on public.referrer_payout_accounts;
create policy "payout_accounts_service_role" on public.referrer_payout_accounts
  for all using (auth.role() = 'service_role');

-- ──────────────────────────────────────────────────────────────────────
-- 6. referral_payouts — one row per weekly payout attempt
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.referral_payouts (
  id                   uuid primary key default gen_random_uuid(),
  referrer_id          uuid not null references public.profiles(id),
  amount_halala        int not null check (amount_halala > 0),
  status               text not null default 'pending'
                       check (status in ('pending', 'processing', 'sent', 'failed')),
  chapa_reference      text not null unique,
  chapa_transfer_id    text,
  payout_account_id    uuid references public.referrer_payout_accounts(id),
  commission_reward_ids uuid[] not null default '{}',
  review_flag          boolean not null default false,
  review_note          text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  failed_reason        text
);

create index if not exists idx_referral_payouts_referrer_created
  on public.referral_payouts (referrer_id, created_at);
create index if not exists idx_referral_payouts_status
  on public.referral_payouts (status);

alter table public.referral_payouts enable row level security;

drop policy if exists "referral_payouts_service_role" on public.referral_payouts;
create policy "referral_payouts_service_role" on public.referral_payouts
  for all using (auth.role() = 'service_role');

-- ──────────────────────────────────────────────────────────────────────
-- 7. get_eligible_withdrawal_amount(): the single source of truth for
--    cash-out eligibility. LEAST(wallet balance, aged/unflagged/unreversed/
--    unpaid commission) so in-app spending can never make us overpay.
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.get_eligible_withdrawal_amount(
  p_referrer_id uuid
) returns int
language plpgsql
as $$
declare
  v_balance int;
  v_eligible int;
begin
  select coalesce(balance_halala, 0) into v_balance
    from public.wallet_credits where profile_id = p_referrer_id;
  if v_balance is null then
    v_balance := 0;
  end if;

  select coalesce(sum(rr.amount_halala), 0) into v_eligible
    from public.referral_rewards rr
    where rr.referrer_id = p_referrer_id
      and rr.reward_type = 'commission'
      and rr.status <> 'pending_review'
      and rr.available_for_withdrawal_at is not null
      and rr.available_for_withdrawal_at <= now()
      and not exists (
        select 1 from public.referral_payouts p
        where p.status in ('sent', 'processing')
          and rr.id = any(p.commission_reward_ids)
      )
      and not exists (
        select 1 from public.commission_reversals cr
        where rr.metadata->>'order_id' ~ '^[0-9a-fA-F-]{36}$'
          and cr.order_id = (rr.metadata->>'order_id')::uuid
      );

  return least(v_balance, v_eligible);
end;
$$;

revoke execute on function public.get_eligible_withdrawal_amount(uuid) from public, anon, authenticated;
grant execute on function public.get_eligible_withdrawal_amount(uuid) to service_role;
