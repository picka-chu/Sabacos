-- Waitlist discounts now expire N days after launch (waitlist toggled off)
-- instead of on the registration deadline.

alter table public.waitlist_config
  add column if not exists discount_grace_period_days integer not null default 30
  check (discount_grace_period_days between 0 and 365);

-- Existing waitlist discounts should not expire on the old deadline if the
-- waitlist is still active. They will be bound to the launch date + grace
-- period the next time the waitlist is turned off.
update public.user_discounts
set expires_at = null
where source in ('waitlist_early_bird', 'waitlist_referral')
  and exists (
    select 1 from public.waitlist_config wc
    where wc.id = '00000000-0000-0000-0000-000000000001' and wc.is_active = true
  );