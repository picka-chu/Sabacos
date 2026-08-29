-- ──────────────────────────────────────────────────────────────────────
-- 0014 — Wallet checkout
-- Lets customers pay for orders with their referral wallet balance.
-- Mirrors finalize_order_payment (stock, order status, payments row) plus an
-- atomic wallet debit.
-- ──────────────────────────────────────────────────────────────────────

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
  item record;
begin
  select status, payment_status, total_halala, profile_id
    into v_order_status, v_payment_status, v_total, v_profile_id
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

  -- Atomic wallet debit (rejects if the balance is short).
  select id, balance_halala into v_wallet_id, v_balance
    from public.wallet_credits where profile_id = v_profile_id;
  if v_wallet_id is null then
    return 'wallet_not_found';
  end if;
  if v_balance < p_amount_halala then
    return 'insufficient_balance';
  end if;

  update public.wallet_credits
    set balance_halala = balance_halala - p_amount_halala,
        updated_at = now()
    where id = v_wallet_id;

  insert into public.wallet_transactions (wallet_id, type, amount_halala, description, reference_type, reference_id)
    values (v_wallet_id, 'debit', p_amount_halala, 'Wallet payment for order', 'order', p_order_id);

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
        payment_status = 'success'
    where id = p_order_id;

  insert into public.payments (order_id, amount_halala, currency, provider, status)
    values (p_order_id, p_amount_halala, 'ETB', 'wallet', 'success');

  return 'ok';
end;
$$;