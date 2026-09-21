-- 0021: Allow bank_split deposit via Chapa (no bank_account_id required).
-- Same logic as finalize_bank_split_deposit but bank_account_id is optional.

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

  -- Update order: deposit paid via Chapa, no bank reference needed.
  update public.orders
    set deposit_halala = v_deposit,
        balance_halala = v_total - v_deposit,
        payment_proof_status = 'approved',
        payment_status = 'success'
    where id = p_order_id;

  return 'ok';
end;
$$;

revoke execute on function public.finalize_bank_split_chapa(uuid) from public, anon, authenticated;
grant execute on function public.finalize_bank_split_chapa(uuid) to service_role;
