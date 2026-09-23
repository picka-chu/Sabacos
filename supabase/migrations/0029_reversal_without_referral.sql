-- 0029: Allow commission reversals without a referrals row.
--
-- Track 2 (repeat-order affiliate) reward rows carry referrer_id +
-- metadata.order_id but referral_id NULL (the referrals row qualifies exactly
-- once for Track 1). Refunds on those orders must still reverse, so
-- commission_reversals.referral_id becomes nullable, and lookups by order
-- get an index.

alter table public.commission_reversals
  alter column referral_id drop not null;

create index if not exists idx_commission_reversals_order
  on public.commission_reversals (order_id);
