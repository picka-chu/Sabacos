-- 0026: Per-product commission toggle.
--
-- Thin-margin SKUs can be excluded from earning referral/affiliate commission
-- (a loss-making bestseller pushed hard by affiliates is the one way the
-- percentage-based commission math breaks). New and existing products default
-- to eligible (true) — exclusion is opt-in per product from the admin UI.
-- The friend discount is unaffected (it applies at order level).

alter table public.products
  add column if not exists commission_eligible boolean not null default true;
