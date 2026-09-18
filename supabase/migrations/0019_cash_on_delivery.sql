-- 0019: Cash on Delivery (COD) support + fix FOR UPDATE + GROUP BY
--
-- Adds a payment_method column, replaces all three finalize functions
-- (broken FOR UPDATE on grouped subqueries), and creates the COD finalizer.

-- 1. Add payment_method to orders (default 'telegram' for existing rows).
alter table public.orders
  add column if not exists payment_method text not null default 'telegram'
  check (payment_method in ('telegram', 'wallet', 'cod'));

-- 2. Update create_order to accept and store payment_method.
create or replace function public.create_order(p_order jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_seq integer;
begin
  if jsonb_typeof(p_order->'items') <> 'array' or jsonb_array_length(p_order->'items') = 0 then
    raise exception 'order must contain at least one item';
  end if;

  v_seq := public.next_order_seq();
  insert into public.orders (
    order_no, profile_id, status, payment_status,
    subtotal_halala, discount_halala, discount_percent, delivery_fee_halala,
    total_halala, customer_name, phone, address, note, latitude, longitude,
    zone, delivery_type, fragile, invoice_payload, payment_method
  ) values (
    'SB-' || lpad(v_seq::text, 6, '0'), (p_order->>'profile_id')::uuid, 'pending_payment', 'pending',
    (p_order->>'subtotal_halala')::integer, coalesce((p_order->>'discount_halala')::integer, 0),
    coalesce((p_order->>'discount_percent')::integer, 0), (p_order->>'delivery_fee_halala')::integer,
    (p_order->>'total_halala')::integer, p_order->>'customer_name', p_order->>'phone',
    p_order->>'address', p_order->>'note', (p_order->>'latitude')::numeric,
    (p_order->>'longitude')::numeric, (p_order->>'zone')::integer,
    coalesce(p_order->>'delivery_type', 'standard'), coalesce((p_order->>'fragile')::boolean, false), '',
    coalesce(p_order->>'payment_method', 'telegram')
  ) returning * into v_order;

  insert into public.order_items (
    order_id, product_id, name_en, name_am, sku, price_halala, qty, subtotal_halala
  )
  select v_order.id, (item->>'product_id')::uuid, item->>'name_en', item->>'name_am', item->>'sku',
    (item->>'price_halala')::integer, (item->>'qty')::integer, (item->>'subtotal_halala')::integer
  from jsonb_array_elements(p_order->'items') as item;

  update public.orders set invoice_payload = v_order.id where id = v_order.id
    returning * into v_order;
  return to_jsonb(v_order);
end;
$$;

-- 3. Fix finalize_order_payment — lock products one at a time (FOR UPDATE
--    cannot be used on a subquery with GROUP BY).
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
  v_rec record;
begin
  select status, payment_status, total_halala
    into v_order_status, v_payment_status, v_total
    from public.orders where id = p_order_id for update;

  if v_order_status is null then return 'order_not_found'; end if;
  if v_payment_status = 'success' then return 'already_processed'; end if;
  if v_order_status <> 'pending_payment' then return 'invalid_status'; end if;
  if v_total is distinct from p_amount_halala then return 'amount_mismatch'; end if;

  -- Lock each product row individually (FOR UPDATE on individual rows is safe).
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

  update public.products p
  set stock = p.stock - needed.qty
  from (
    select product_id, sum(qty)::integer as qty
    from public.order_items where order_id = p_order_id group by product_id
  ) needed
  where p.id = needed.product_id;

  update public.orders
    set status = 'paid', payment_status = 'success',
        telegram_payment_charge_id = p_telegram_charge_id,
        provider_payment_charge_id = p_provider_charge_id
    where id = p_order_id;
  insert into public.payments (order_id, amount_halala, currency, provider, status, telegram_payment_id, provider_charge_id)
    values (p_order_id, p_amount_halala, 'ETB', 'telegram', 'success', p_telegram_charge_id, p_provider_charge_id);
  return 'ok';
end;
$$;

-- 4. Fix finalize_wallet_payment — same FOR UPDATE fix.
create or replace function public.finalize_wallet_payment(
  p_order_id uuid,
  p_amount_halala integer
) returns text
language plpgsql
as $$
declare
  v_order_status text;
  v_payment_status text;
  v_total integer;
  v_profile_id uuid;
  v_wallet_id uuid;
  v_balance integer;
  v_rec record;
begin
  select status, payment_status, total_halala, profile_id
    into v_order_status, v_payment_status, v_total, v_profile_id
    from public.orders where id = p_order_id for update;
  if v_order_status is null then return 'order_not_found'; end if;
  if v_payment_status = 'success' then return 'already_processed'; end if;
  if v_order_status <> 'pending_payment' then return 'invalid_status'; end if;
  if v_total is distinct from p_amount_halala then return 'amount_mismatch'; end if;

  select id, balance_halala into v_wallet_id, v_balance
    from public.wallet_credits where profile_id = v_profile_id for update;
  if v_wallet_id is null then return 'wallet_not_found'; end if;
  if v_balance < p_amount_halala then return 'insufficient_balance'; end if;

  -- Lock each product row individually.
  for v_rec in
    select product_id, sum(qty)::integer as qty
    from public.order_items where order_id = p_order_id
    group by product_id order by product_id
  loop
    perform 1 from public.products where id = v_rec.product_id for update;
  end loop;

  if exists (
    select 1 from (
      select product_id, sum(qty)::integer as qty
      from public.order_items where order_id = p_order_id group by product_id
    ) needed left join public.products p on p.id = needed.product_id
    where p.id is null or p.stock < needed.qty
  ) then return 'insufficient_stock'; end if;

  update public.wallet_credits set balance_halala = balance_halala - p_amount_halala, updated_at = now()
    where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, type, amount_halala, description, reference_type, reference_id)
    values (v_wallet_id, 'debit', p_amount_halala, 'Wallet payment for order', 'order', p_order_id);
  update public.products p set stock = p.stock - needed.qty
    from (select product_id, sum(qty)::integer as qty from public.order_items where order_id = p_order_id group by product_id) needed
    where p.id = needed.product_id;
  update public.orders set status = 'paid', payment_status = 'success' where id = p_order_id;
  insert into public.payments (order_id, amount_halala, currency, provider, status)
    values (p_order_id, p_amount_halala, 'ETB', 'wallet', 'success');
  return 'ok';
end;
$$;

-- 5. Atomic COD finalization — locks products, validates stock, decrements, marks paid.
create or replace function public.finalize_cod_payment(
  p_order_id uuid
) returns text
language plpgsql
as $$
declare
  v_order_status text;
  v_payment_status text;
  v_rec record;
begin
  select status, payment_status
    into v_order_status, v_payment_status
    from public.orders where id = p_order_id for update;

  if v_order_status is null then return 'order_not_found'; end if;
  if v_payment_status = 'success' then return 'already_processed'; end if;
  if v_order_status <> 'pending_payment' then return 'invalid_status'; end if;

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

  update public.products p
  set stock = p.stock - needed.qty
  from (
    select product_id, sum(qty)::integer as qty
    from public.order_items where order_id = p_order_id group by product_id
  ) needed
  where p.id = needed.product_id;

  update public.orders
    set status = 'paid', payment_status = 'success'
    where id = p_order_id;

  insert into public.payments (order_id, amount_halala, currency, provider, status)
    select p_order_id, total_halala, 'ETB', 'cod', 'success'
    from public.orders where id = p_order_id;

  return 'ok';
end;
$$;

revoke execute on function public.finalize_order_payment(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.finalize_order_payment(uuid, text, text, integer) to service_role;

revoke execute on function public.finalize_wallet_payment(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_wallet_payment(uuid, integer) to service_role;

revoke execute on function public.finalize_cod_payment(uuid) from public, anon, authenticated;
grant execute on function public.finalize_cod_payment(uuid) to service_role;
