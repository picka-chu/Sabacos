-- 0018: Create an order, its immutable item snapshot, and invoice payload in
-- one database transaction. Supabase RPC calls are transactional, unlike the
-- previous three independent PostgREST requests.

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
    zone, delivery_type, fragile, invoice_payload
  ) values (
    'SB-' || lpad(v_seq::text, 6, '0'), (p_order->>'profile_id')::uuid, 'pending_payment', 'pending',
    (p_order->>'subtotal_halala')::integer, coalesce((p_order->>'discount_halala')::integer, 0),
    coalesce((p_order->>'discount_percent')::integer, 0), (p_order->>'delivery_fee_halala')::integer,
    (p_order->>'total_halala')::integer, p_order->>'customer_name', p_order->>'phone',
    p_order->>'address', p_order->>'note', (p_order->>'latitude')::numeric,
    (p_order->>'longitude')::numeric, (p_order->>'zone')::integer,
    coalesce(p_order->>'delivery_type', 'standard'), coalesce((p_order->>'fragile')::boolean, false), ''
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

-- Shared, database-backed fixed-window rate limiter. Advisory locking makes
-- increments serializable across every application instance.
create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
alter table public.rate_limit_buckets enable row level security;

create or replace function public.consume_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_limit integer
) returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket public.rate_limit_buckets%rowtype;
begin
  if length(p_key) <> 64 or p_window_seconds < 1 or p_limit < 1 then
    raise exception 'invalid rate-limit parameters';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select * into v_bucket from public.rate_limit_buckets where bucket_key = p_key for update;

  if not found or v_bucket.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    insert into public.rate_limit_buckets as b (bucket_key, window_started_at, request_count)
      values (p_key, v_now, 1)
    on conflict (bucket_key) do update set window_started_at = excluded.window_started_at, request_count = 1
    returning * into v_bucket;
  elsif v_bucket.request_count >= p_limit then
    return query select false, 0, v_bucket.window_started_at + make_interval(secs => p_window_seconds);
    return;
  else
    update public.rate_limit_buckets set request_count = request_count + 1 where bucket_key = p_key
      returning * into v_bucket;
  end if;

  -- Opportunistic bounded cleanup keeps storage finite without a separate job.
  delete from public.rate_limit_buckets where bucket_key in (
    select bucket_key from public.rate_limit_buckets
    where window_started_at < v_now - interval '1 day' and bucket_key <> p_key
    limit 100
  );
  return query select true, greatest(0, p_limit - v_bucket.request_count),
    v_bucket.window_started_at + make_interval(secs => p_window_seconds);
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
