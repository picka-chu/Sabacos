-- 0019: Cash on Delivery (COD) support
--
-- Adds a payment_method column to track how the customer chose to pay, and a
-- finalize_cod_payment() function that atomically decrements stock + marks the
-- order as paid when the delivery agent confirms cash collection.

-- 1. Add payment_method to orders (default 'telegram' for existing rows).
alter table public.orders
  add column payment_method text not null default 'telegram'
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

-- 3. Atomic COD finalization: called when the delivery agent confirms cash
--    collection.  Validates stock, decrements inventory, marks paid.
create or replace function public.finalize_cod_payment(
  p_order_id uuid
) returns text
language plpgsql
as $$
declare
  v_order_status text;
  v_payment_status text;
begin
  select status, payment_status
    into v_order_status, v_payment_status
    from public.orders where id = p_order_id for update;

  if v_order_status is null then return 'order_not_found'; end if;
  if v_payment_status = 'success' then return 'already_processed'; end if;
  if v_order_status <> 'pending_payment' then return 'invalid_status'; end if;

  -- Lock products in a stable order to serialize competing checkouts.
  perform 1
  from public.products p
  join (
    select product_id, sum(qty)::integer as qty
    from public.order_items where order_id = p_order_id group by product_id
  ) needed on needed.product_id = p.id
  order by p.id
  for update;

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

revoke execute on function public.finalize_cod_payment(uuid) from public, anon, authenticated;
grant execute on function public.finalize_cod_payment(uuid) to service_role;
