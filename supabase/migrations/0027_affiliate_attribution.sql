-- 0027: Track 2 (affiliate) attribution plumbing.
--
--  - orders.attributed_to_profile_id: which referrer drove this order
--    (last-click product share). Null = unattributed. Server-validated at
--    checkout — the client may suggest it, but the server resolves and
--    verifies the profile (exists, not the buyer themselves).
--  - referral_rewards.referral_id becomes nullable: Track 2 (repeat-order)
--    commission has no referral row (the row qualifies exactly once for
--    Track 1); those reward rows carry referrer_id + metadata.order_id.
--  - affiliate_percent (default 10): per-order affiliate rate, kept as a
--    separate setting from the first-order bounty so the two tracks can
--    diverge later without a schema change.
--  - Index for velocity/fraud queries over attributed orders.

alter table public.orders
  add column if not exists attributed_to_profile_id uuid references public.profiles(id);

create index if not exists idx_orders_attributed_to_created
  on public.orders (attributed_to_profile_id, created_at);

alter table public.referral_rewards
  alter column referral_id drop not null;

alter table public.referral_settings
  add column if not exists affiliate_percent int not null default 10;

-- create_order: accept and store attributed_to_profile_id (otherwise the
-- 0019 version of this function; reproduced in full).
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
    zone, delivery_type, fragile, invoice_payload, payment_method,
    attributed_to_profile_id
  ) values (
    'SB-' || lpad(v_seq::text, 6, '0'), (p_order->>'profile_id')::uuid, 'pending_payment', 'pending',
    (p_order->>'subtotal_halala')::integer, coalesce((p_order->>'discount_halala')::integer, 0),
    coalesce((p_order->>'discount_percent')::integer, 0), (p_order->>'delivery_fee_halala')::integer,
    (p_order->>'total_halala')::integer, p_order->>'customer_name', p_order->>'phone',
    p_order->>'address', p_order->>'note', (p_order->>'latitude')::numeric,
    (p_order->>'longitude')::numeric, (p_order->>'zone')::integer,
    coalesce(p_order->>'delivery_type', 'standard'), coalesce((p_order->>'fragile')::boolean, false), '',
    coalesce(p_order->>'payment_method', 'telegram'),
    case when p_order->>'attributed_to_profile_id' ~ '^[0-9a-fA-F-]{36}$'
      then (p_order->>'attributed_to_profile_id')::uuid
      else null end
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

revoke execute on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;
