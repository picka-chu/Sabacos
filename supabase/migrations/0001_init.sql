-- Sabacos: initial schema
-- Run via: supabase db push  (or apply in the Supabase SQL editor)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint unique,
  username    text,
  first_name  text,
  last_name   text,
  phone       text,
  address     text,
  role        text not null default 'customer'
              check (role in ('customer', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -------------------------------------------------------------- categories
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name_en    text not null,
  name_am    text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- products
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  category_id       uuid references public.categories (id) on delete set null,
  sku               text unique not null,
  name_en           text not null,
  name_am           text not null,
  description_en    text not null default '',
  description_am    text not null default '',
  price_halala      integer not null check (price_halala >= 0),
  compare_at_halala integer check (compare_at_halala is null or compare_at_halala >= 0),
  stock             integer not null default 0 check (stock >= 0),
  image_urls        text[] not null default '{}',
  is_active         boolean not null default true,
  is_featured       boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- -------------------------------------------------------------- cart_items
create table if not exists public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  qty        integer not null check (qty between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, product_id)
);

-- ------------------------------------------------------------------ orders
create table if not exists public.orders (
  id                          uuid primary key default gen_random_uuid(),
  order_no                    text unique not null,
  profile_id                  uuid not null references public.profiles (id),
  status                      text not null default 'pending_payment'
                              check (status in ('pending_payment', 'paid', 'processing',
                                                'shipped', 'delivered', 'cancelled')),
  subtotal_halala             integer not null check (subtotal_halala >= 0),
  delivery_fee_halala         integer not null default 0 check (delivery_fee_halala >= 0),
  total_halala                integer not null check (total_halala >= 0),
  customer_name               text not null,
  phone                       text not null,
  address                     text not null,
  note                        text,
  invoice_payload             text not null default '',
  telegram_payment_charge_id  text,
  provider_payment_charge_id  text,
  payment_status              text not null default 'pending'
                              check (payment_status in ('pending', 'success', 'failed', 'refunded')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ------------------------------------------------------------- order_items
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  product_id      uuid references public.products (id) on delete set null,
  name_en         text not null,
  name_am         text not null,
  sku             text not null,
  price_halala    integer not null check (price_halala >= 0),
  qty             integer not null check (qty > 0),
  subtotal_halala integer not null check (subtotal_halala >= 0)
);

-- --------------------------------------------------------------- payments
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  amount_halala       integer not null check (amount_halala >= 0),
  currency            text not null default 'ETB',
  provider            text not null default 'telegram',
  status              text not null default 'pending'
                      check (status in ('pending', 'success', 'failed', 'refunded')),
  telegram_payment_id text,
  provider_charge_id  text,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------- settings
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

insert into public.settings (key, value)
values ('store', '{
  "delivery_fee_halala": 12000,
  "free_delivery_threshold_halala": 150000,
  "shop_name_en": "Sabacos",
  "shop_name_am": "ሳባኮስ",
  "shop_phone": "+251900000000",
  "admin_channel_id": null
}'::jsonb)
on conflict (key) do nothing;

-- ----------------------------------------------------------------- indexes
create index if not exists idx_products_category on public.products (category_id);
create index if not exists idx_products_active on public.products (is_active);
create index if not exists idx_cart_profile on public.cart_items (profile_id);
create index if not exists idx_orders_profile on public.orders (profile_id);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_payments_order on public.payments (order_id);

-- ------------------------------------------------------------- updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated on public.profiles;
drop trigger if exists trg_products_updated on public.products;
drop trigger if exists trg_cart_items_updated on public.cart_items;
drop trigger if exists trg_orders_updated on public.orders;

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();
create trigger trg_cart_items_updated before update on public.cart_items
  for each row execute function public.set_updated_at();
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- row security
-- All reads/writes go through the server (service role, bypasses RLS).
-- Enable RLS so anon/authenticated keys can never touch the tables directly.
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.settings enable row level security;

-- ------------------------------------------------------------ sequences
-- Atomic order-number sequence (called via client.rpc('next_order_seq')).
create or replace function public.next_order_seq()
returns integer
language plpgsql
as $$
declare seq integer;
begin
  insert into public.settings (key, value)
  values ('order_seq', '{"count":1}'::jsonb)
  on conflict (key) do update
    set value = jsonb_set(
      value,
      '{count}',
      to_jsonb((coalesce((value->>'count')::int, 0) + 1))
    )
  returning (value->>'count')::int into seq;
  return seq;
end;
$$;

-- ------------------------------------------------- payment finalization
-- Atomically finalizes an order on successful payment:
-- guards stock, writes payment row, marks order paid. Returns a status string.
create or replace function public.finalize_order_payment(
  p_order_id uuid,
  p_telegram_charge_id text,
  p_provider_charge_id text,
  p_amount_halala integer
) returns text
language plpgsql
as $$
declare
  v_order_status text;
  v_payment_status text;
  v_total integer;
  item record;
begin
  select status, payment_status, total_halala
    into v_order_status, v_payment_status, v_total
    from public.orders where id = p_order_id for update;

  if v_order_status is null then
    return 'order_not_found';
  end if;
  if v_payment_status = 'success' then
    return 'already_processed';
  end if;
  if v_order_status <> 'pending_payment' then
    return 'invalid_status';
  end if;
  if v_total is distinct from p_amount_halala then
    return 'amount_mismatch';
  end if;

  for item in select product_id, qty from public.order_items where order_id = p_order_id loop
    update public.products
      set stock = stock - item.qty
      where id = item.product_id and stock >= item.qty;
    if not found then
      return 'insufficient_stock';
    end if;
  end loop;

  update public.orders
    set status = 'paid',
        payment_status = 'success',
        telegram_payment_charge_id = p_telegram_charge_id,
        provider_payment_charge_id = p_provider_charge_id
    where id = p_order_id;

  insert into public.payments (order_id, amount_halala, currency, provider, status, telegram_payment_id, provider_charge_id)
  values (p_order_id, p_amount_halala, 'ETB', 'telegram', 'success', p_telegram_charge_id, p_provider_charge_id);

  return 'ok';
end;
$$;

-- ----------------------------------------------------------------- storage
-- Public bucket for product images (admin uploads via service role).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "Public read product images"
  on storage.objects for select
  using (bucket_id = 'product-images');