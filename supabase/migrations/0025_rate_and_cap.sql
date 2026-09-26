-- 0025: Commission rate 10%, rolling cap 8,000 ETB, friend discount stays 5%.
--
-- Math: representative qualifying order ~3,500 ETB (products run 1,000-7,000
-- ETB) pays 10% = ~350 ETB (35,000 halala) commission. A cap of 8,000 ETB
-- (800,000 halala) covers ~23 such referrals per rolling 30 days, with the
-- soft review flag at 60% (~4,800 ETB, ~14 referrals) — tighter human
-- oversight exactly when payouts get serious. Worst case per order giveaway
-- is 10% commission + 5% friend discount = 15%, safe against 35-40% margins.

alter table public.referral_settings
  alter column first_purchase_percent set default 10;

alter table public.referral_settings
  alter column monthly_cap_halala set default 800000;

update public.referral_settings
  set first_purchase_percent = 10,
      monthly_cap_halala = 800000,
      referred_discount_percent = 5,
      updated_at = now()
  where id = '00000000-0000-0000-0000-000000000001'
    -- Repair-safe: only upgrade rows still holding the previous terms,
    -- never clobber admin-customized values on rerun.
    and first_purchase_percent = 5
    and monthly_cap_halala = 500000;
