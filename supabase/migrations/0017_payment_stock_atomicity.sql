-- 0017: Prevent partial stock deductions and wallet debits on failed payments.
--
-- Both payment finalizers must verify every line item while holding the
-- relevant product locks *before* mutating balances or inventory.  Returning
-- from a PL/pgSQL function does not roll back earlier statements, so the old
-- per-line update loop could leave an order partially processed.

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
begin
  select status, payment_status, total_halala
    into v_order_status, v_payment_status, v_total
    from public.orders where id = p_order_id for update;

  if v_order_status is null then return 'order_not_found'; end if;
  if v_payment_status = 'success' then return 'already_processed'; end if;
  if v_order_status <> 'pending_payment' then return 'invalid_status'; end if;
  if v_total is distinct from p_amount_halala then return 'amount_mismatch'; end if;

  -- Lock products in a stable order. This serializes competing checkouts for
  -- the same SKU and makes the subsequent availability check race-free.
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
    set status = 'paid', payment_status = 'success',
        telegram_payment_charge_id = p_telegram_charge_id,
        provider_payment_charge_id = p_provider_charge_id
    where id = p_order_id;
  insert into public.payments (order_id, amount_halala, currency, provider, status, telegram_payment_id, provider_charge_id)
    values (p_order_id, p_amount_halala, 'ETB', 'telegram', 'success', p_telegram_charge_id, p_provider_charge_id);
  return 'ok';
end;
$$;

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

  perform 1
  from public.products p
  join (
    select product_id, sum(qty)::integer as qty
    from public.order_items where order_id = p_order_id group by product_id
  ) needed on needed.product_id = p.id
  order by p.id
  for update;
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
