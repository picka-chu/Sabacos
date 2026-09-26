-- 0031: Money-integrity fixes (audit batch 1).
--
-- F18. Concurrent payout runs (overlapping cron/manual) can double-insert
-- for one referrer: the same-week guard is check-then-insert. A stored week
-- bucket + partial unique index makes duplicates impossible at the DB level
-- (Monday weeks, matching startOfWeekUtc in TS; failed rows excluded so
-- retries stay possible). NOTE: this must be a STORED column, not an
-- expression index — date_trunc is STABLE and Postgres rejects it in index
-- expressions (42P17).
alter table public.referral_payouts add column if not exists payout_week_start date;
update public.referral_payouts
  set payout_week_start = (date_trunc('week', created_at))::date
  where payout_week_start is null;
create unique index if not exists uq_referral_payouts_referrer_week
  on public.referral_payouts (referrer_id, payout_week_start)
  where status in ('pending', 'processing', 'sent');

-- C7. orders.payment_method CHECK: 0019 created it with
-- ('telegram','wallet','cod'); 0020's ADD COLUMN IF NOT EXISTS then no-opped
-- on migrated DBs, so every bank_split insert violates the old CHECK.
-- Recreate it with all four values.
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('telegram', 'wallet', 'cod', 'bank_split'));

-- Coupons (audit F7): record which coupon an order used so it can be
-- consumed at payment-finalize time instead of invoice-creation time
-- (unpaid invoices used to burn coupons permanently).
alter table public.orders add column if not exists coupon_code text;

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
    attributed_to_profile_id, coupon_code
  ) values (
    'SB-' || lpad(v_seq::text, 6, 0), (p_order->>'profile_id')::uuid, 'pending_payment', 'pending',
    (p_order->>'subtotal_halala')::integer, coalesce((p_order->>'discount_halala')::integer, 0),
    coalesce((p_order->>'discount_percent')::integer, 0), (p_order->>'delivery_fee_halala')::integer,
    (p_order->>'total_halala')::integer, p_order->>'customer_name', p_order->>'phone',
    p_order->>'address', p_order->>'note', (p_order->>'latitude')::numeric,
    (p_order->>'longitude')::numeric, (p_order->>'zone')::integer,
    coalesce(p_order->>'delivery_type', 'standard'), coalesce((p_order->>'fragile')::boolean, false), '',
    coalesce(p_order->>'payment_method', 'telegram'),
    case when p_order->>'attributed_to_profile_id' ~ '^[0-9a-fA-F-]{36}$'
      then (p_order->>'attributed_to_profile_id')::uuid
      else null end,
    nullif(p_order->>'coupon_code', '')
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

-- C1b. Chapa split deposit is real money in: mark the order paid so admin
-- buttons can advance it (pending_payment -> paid) and the delivered hook —
-- the only place split commission fires — becomes reachable.
create or replace function public.finalize_bank_split_chapa(
  p_order_id uuid
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

  v_deposit := greatest(1, (v_total + 1) / 2);

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

  -- Update order: deposit paid via Chapa, no bank reference needed.
  update public.orders
    set deposit_halala = v_deposit,
        balance_halala = v_total - v_deposit,
        payment_proof_status = 'approved',
        payment_status = 'success',
        status = 'paid'
    where id = p_order_id;

  return 'ok';
end;
$$;

-- C1c. Idempotency: the deposit RPC runs once at checkout (recording the
-- deposit + reserving stock). Approval paths must not run it again — a
-- second run used to double-decrement stock AND reset an approved proof
-- back to 'pending'.
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
  v_recorded_deposit integer;
  v_rec record;
begin
  select status, payment_status, total_halala
    into v_order_status, v_payment_status, v_total
    from public.orders where id = p_order_id for update;

  if v_order_status is null then return 'order_not_found'; end if;
  if v_payment_status = 'success' then return 'already_processed'; end if;
  if v_order_status <> 'pending_payment' then return 'invalid_status'; end if;

  select deposit_halala into v_recorded_deposit
    from public.orders where id = p_order_id;
  if v_recorded_deposit is not null then return 'already_processed'; end if;

  v_deposit := greatest(1, (v_total + 1) / 2);

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

-- C3. Commission idempotency inside the credit RPC: one Track-1 commission
-- per referral ever; one Track-2 commission per (referrer, order).
-- Concurrent callers serialize on the advisory lock below, so the loser
-- observes the winner's row and gets 'duplicate' instead of double-paying.
create or replace function public.credit_referral_commission(
  p_referral_id uuid,
  p_order_id uuid,
  p_raw_commission_halala int,
  p_review_threshold_pct numeric default 0.6,
  p_referrer_id uuid default null,
  p_flag_reason text default null
) returns jsonb
language plpgsql
as $$
declare
  v_referrer_id uuid;
  v_active boolean;
  v_cap int;
  v_rolling int;
  v_remaining int;
  v_actual int;
  v_status text;
begin
  if p_referral_id is not null then
    select referrer_id into v_referrer_id
      from public.referrals where id = p_referral_id;
  elsif p_referrer_id is not null then
    v_referrer_id := p_referrer_id;
  end if;
  if v_referrer_id is null then
    return jsonb_build_object(
      'status', 'referral_not_found',
      'credited_halala', 0,
      'flagged', false
    );
  end if;

  select is_active, monthly_cap_halala into v_active, v_cap
    from public.referral_settings
    where id = '00000000-0000-0000-0000-000000000001';
  if not found or not v_active then
    return jsonb_build_object(
      'status', 'program_inactive',
      'credited_halala', 0,
      'flagged', false
    );
  end if;

  -- Serialize concurrent credits for THIS referrer only; other referrers
  -- hash to different lock keys and proceed in parallel.
  perform pg_advisory_xact_lock(hashtext(v_referrer_id::text));

  -- Idempotency gate (see header comment).
  if p_referral_id is not null then
    if exists (
      select 1 from public.referral_rewards
      where referral_id = p_referral_id and reward_type = 'commission'
    ) then
      return jsonb_build_object(
        'status', 'duplicate',
        'credited_halala', 0,
        'flagged', false
      );
    end if;
  elsif exists (
    select 1 from public.referral_rewards
    where referrer_id = v_referrer_id
      and reward_type = 'commission'
      and (metadata->>'order_id') = p_order_id::text
  ) then
    return jsonb_build_object(
      'status', 'duplicate',
      'credited_halala', 0,
      'flagged', false
    );
  end if;

  -- Rolling 30-day window (no calendar-month reset exploit).
  select coalesce(sum(amount_halala), 0) into v_rolling
    from public.referral_rewards
    where referrer_id = v_referrer_id
      and reward_type = 'commission'
      and created_at >= now() - interval '30 days';

  v_remaining := greatest(0, v_cap - v_rolling);
  v_actual := least(p_raw_commission_halala, v_remaining);

  if v_actual <= 0 then
    return jsonb_build_object(
      'status', 'cap_reached',
      'credited_halala', 0,
      'rolling_total_halala', v_rolling,
      'cap_halala', v_cap,
      'flagged', false
    );
  end if;

  -- Soft review flag: still credited (immediately spendable in-app), but
  -- marked for a manual check; withdrawal eligibility excludes flagged rows.
  if p_flag_reason is not null
    or (v_rolling + v_actual) >= (v_cap * p_review_threshold_pct) then
    v_status := 'pending_review';
  else
    v_status := 'confirmed';
  end if;

  -- Reuse the existing atomic wallet credit (same pattern as before).
  perform public.credit_wallet(
    v_referrer_id,
    v_actual,
    format('Commission from referral order (%s)', p_order_id),
    'commission',
    p_referral_id
  );

  insert into public.referral_rewards
    (referral_id, referrer_id, reward_type, amount_halala, status,
     available_for_withdrawal_at, metadata)
  values
    (p_referral_id, v_referrer_id, 'commission', v_actual, v_status,
     now() + interval '7 days',
     jsonb_build_object('order_id', p_order_id, 'raw_commission_halala', p_raw_commission_halala,
                        'flags', coalesce(p_flag_reason, '')));

  return jsonb_build_object(
    'status', 'credited',
    'credited_halala', v_actual,
    'rolling_total_halala', v_rolling + v_actual,
    'cap_halala', v_cap,
    'flagged', v_status = 'pending_review'
  );
end;
$$;
