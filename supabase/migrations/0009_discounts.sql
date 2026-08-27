-- Promotions / discount engine: shop-wide, category-based, or product-based
-- discounts applied automatically at checkout and shown as sale badges.

create table if not exists public.discounts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text not null default '',
  discount_type       text not null check (discount_type in ('percent', 'fixed'))
                      default 'percent',
  -- percent: 1-100 | fixed: ETB amount off per item
  discount_value      numeric(6,2) not null check (discount_value > 0),
  scope               text not null check (scope in ('all', 'category', 'products'))
                      default 'all',
  category_id         uuid references public.categories (id) on delete cascade,
  product_ids         uuid[] not null default '{}',
  min_subtotal_halala integer check (min_subtotal_halala is null or min_subtotal_halala >= 0),
  starts_at           timestamptz,
  ends_at             timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint discounts_scope_category check (scope <> 'category' or category_id is not null),
  constraint discounts_scope_products check (scope <> 'products' or cardinality(product_ids) > 0)
);

create index if not exists idx_discounts_active on public.discounts (is_active);
create index if not exists idx_discounts_category on public.discounts (category_id);

-- -------------------------------------------------------------- updated_at
drop trigger if exists trg_discounts_updated on public.discounts;
create trigger trg_discounts_updated before update on public.discounts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ row security
alter table public.discounts enable row level security;