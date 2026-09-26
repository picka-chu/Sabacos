-- 0020: Bank accounts, split payment (half now / half on delivery)
--
-- Adds a bank_accounts table for admin-managed bank transfer destinations,
-- extends orders with split-payment tracking, and creates the atomic
-- finalize_bank_split_deposit() function.

-- 1. Bank accounts managed by admin
create table if not exists public.bank_accounts (
  id            uuid primary key default gen_random_uuid(),
  bank_name     text not null check (bank_name in ('cbe', 'birr', 'telebirr', 'awash', 'abyssinia')),
  account_name  text not null,
  account_number text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2. Extend orders for split payment
alter table public.orders
  add column if not exists payment_method text not null default 'telegram'
  check (payment_method in ('telegram', 'wallet', 'cod', 'bank_split'));

alter table public.orders
  add column if not exists deposit_halala integer check (deposit_halala >= 0);

alter table public.orders
  add column if not exists balance_halala integer check (balance_halala >= 0);

alter table public.orders
  add column if not exists bank_account_id uuid references public.bank_accounts (id);

alter table public.orders
  add column if not exists payment_proof_url text;

alter table public.orders
  add column if not exists payment_proof_status text default 'none'
  check (payment_proof_status in ('none', 'pending', 'approved', 'rejected'));

alter table public.orders
  add column if not exists payment_proof_rejection_reason text;

-- 3. Atomic deposit finalization for bank split payments
create or replace function public.finalize_bank_split_deposit(
  p_order_id uuid,
  p_bank_account_id uuid
) returns text
language plpgsql
as $$
declare
  v_order_status text;
  v_payment_status text;
  v_total integer;
  v_deposit integer;
  v_rec record;
begin
  select status, payment_status, total_halala
    into v_order_status, v_payment_status, v_total
    from public.orders where id = p_order_id for update;

  if v_order_status is null then return 'order_not_found'; end if;
  if v_payment_status = 'success' then return 'already_processed'; end if;
  if v_order_status <> 'pending_payment' then return 'invalid_status'; end if;

  v_deposit := greatest(1, v_total / 2);

  -- Lock each product row individually.
  for v_rec in
    select product_id, sum(qty)::integer as qty
    from public.order_items where order_id = p_order_id
    group by product_id order by product_id
  loop
    perform 1 from public.products where id = v_rec.product_id for update;
  end loop;

  if exists (
    select 1
    from (
      select product_id, sum(qty)::integer as qty
      from public.order_items where order_id = p_order_id group by product_id
    ) needed
    left join public.products p on p.id = needed.product_id
    where p.id is null or p.stock < needed.qty
  ) then return 'insufficient_stock'; end if;

  -- Decrement stock atomically.
  update public.products p
  set stock = p.stock - needed.qty
  from (
    select product_id, sum(qty)::integer as qty
    from public.order_items where order_id = p_order_id group by product_id
  ) needed
  where p.id = needed.product_id;

  -- Update order with split details and bank reference.
  update public.orders
    set deposit_halala = v_deposit,
        balance_halala = v_total - v_deposit,
        bank_account_id = p_bank_account_id,
        payment_proof_status = 'pending'
    where id = p_order_id;

  return 'ok';
end;
$$;

revoke execute on function public.finalize_bank_split_deposit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_bank_split_deposit(uuid, uuid) to service_role;

-- 4. Public read access for bank_accounts (anon + authenticated can list active accounts)
alter table public.bank_accounts enable row level security;

drop policy if exists "bank_accounts_select_active" on public.bank_accounts;
create policy "bank_accounts_select_active" on public.bank_accounts
  for select using (is_active = true);

drop policy if exists "bank_accounts_all_admin" on public.bank_accounts;
create policy "bank_accounts_all_admin" on public.bank_accounts
  for all using (auth.role() = 'service_role');
