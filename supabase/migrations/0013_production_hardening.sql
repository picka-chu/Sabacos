-- 0013: Production hardening
-- product cost tracking, refund reversal, daily spend cap, data retention

-- ──────────────────────────────────────────────────────────────────────
-- PRODUCT COST TRACKING
-- Real COGS instead of hardcoded 40%
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cost_halala int NOT NULL DEFAULT 0;

-- ──────────────────────────────────────────────────────────────────────
-- COMMISSION REVERSAL LOG
-- Tracks clawbacks when referred orders are refunded
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_reversals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL,
  amount_halala int NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_commission_reversals_referral ON commission_reversals(referral_id);

-- ──────────────────────────────────────────────────────────────────────
-- DAILY SPEND CAP TRACKING
-- Prevents runaway spending between weekly adjustments
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE referral_settings
  ADD COLUMN IF NOT EXISTS daily_spend_cap_halala int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_spend_cap_enabled boolean NOT NULL DEFAULT false;

-- ──────────────────────────────────────────────────────────────────────
-- UPDATED AGGREGATION RPC with real COGS
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION aggregate_daily_metrics(p_date date)
RETURNS jsonb AS $$
DECLARE
  v_start timestamptz := p_date;
  v_end   timestamptz := p_date + interval '1 day';
  v_row   daily_metrics%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM daily_metrics WHERE date = p_date) THEN
    RETURN jsonb_build_object('status', 'already_aggregated', 'date', p_date);
  END IF;

  -- Revenue: all paid orders created on this date
  SELECT
    COALESCE(SUM(total_halala), 0),
    COUNT(*)
  INTO v_row.total_revenue_halala, v_row.total_orders_count
  FROM orders
  WHERE status NOT IN ('cancelled', 'pending_payment')
    AND created_at >= v_start AND created_at < v_end;

  -- Refunds (cancelled + refunded)
  SELECT
    COALESCE(SUM(total_halala), 0),
    COUNT(*)
  INTO v_row.total_refunds_halala, v_row.total_refunds_count
  FROM orders
  WHERE status = 'cancelled'
    AND payment_status = 'refunded'
    AND updated_at >= v_start AND updated_at < v_end;

  -- Real COGS: sum of (product.cost_halala * order_item.qty) for non-cancelled orders
  SELECT
    COALESCE(SUM(oi.subtotal_halala * COALESCE(p.cost_halala, 0) / NULLIF(p.price_halala, 0)), 0)
  INTO v_row.total_cogs_halala
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE o.status NOT IN ('cancelled', 'pending_payment')
    AND o.created_at >= v_start AND o.created_at < v_end;

  -- Referral activity
  SELECT COUNT(*)
  INTO v_row.new_referrals_count
  FROM referrals
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT COUNT(*)
  INTO v_row.qualified_referrals_count
  FROM referrals
  WHERE status = 'qualified'
    AND qualified_at >= v_start AND qualified_at < v_end;

  -- Referred orders
  SELECT
    COUNT(*),
    COALESCE(SUM(o.total_halala), 0)
  INTO v_row.referred_orders_count, v_row.referred_revenue_halala
  FROM orders o
  JOIN referrals r ON r.referred_id = o.profile_id
  WHERE r.status = 'qualified'
    AND o.status NOT IN ('cancelled', 'pending_payment')
    AND o.created_at >= v_start AND o.created_at < v_end;

  -- Commission paid out (credits only, exclude reversals)
  SELECT COALESCE(SUM(amount_halala), 0)
  INTO v_row.commission_paid_halala
  FROM referral_rewards
  WHERE reward_type = 'commission'
    AND created_at >= v_start AND created_at < v_end;

  -- Subtract commission reversals
  DECLARE v_reversals int;
  BEGIN
    SELECT COALESCE(SUM(amount_halala), 0) INTO v_reversals
    FROM commission_reversals
    WHERE created_at >= v_start AND created_at < v_end;
    v_row.commission_paid_halala := GREATEST(0, v_row.commission_paid_halala - v_reversals);
  END;

  -- Spinner activity
  SELECT COUNT(*)
  INTO v_row.spins_granted_count
  FROM spinner_spins
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT COUNT(*)
  INTO v_row.spins_used_count
  FROM spinner_spins
  WHERE status = 'used'
    AND won_at >= v_start AND won_at < v_end;

  -- Spinner cost: prize value for used spins (exclude spin_again)
  SELECT COALESCE(SUM(sp.value), 0)
  INTO v_row.spinner_cost_halala
  FROM spinner_spins ss
  JOIN spinner_prizes sp ON sp.id = ss.won_prize_id
  WHERE ss.status = 'used'
    AND ss.won_at >= v_start AND ss.won_at < v_end
    AND sp.prize_type != 'spin_again';

  -- Coupons
  SELECT COUNT(*)
  INTO v_row.coupons_issued_count
  FROM spinner_coupons
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT COUNT(*)
  INTO v_row.coupons_redeemed_count
  FROM spinner_coupons
  WHERE is_used = true
    AND used_at >= v_start AND used_at < v_end;

  -- Wallet activity
  SELECT COALESCE(SUM(amount_halala), 0)
  INTO v_row.wallet_credits_halala
  FROM wallet_transactions
  WHERE type IN ('credit', 'refund')
    AND created_at >= v_start AND created_at < v_end;

  SELECT COALESCE(SUM(amount_halala), 0)
  INTO v_row.wallet_debits_halala
  FROM wallet_transactions
  WHERE type = 'debit'
    AND created_at >= v_start AND created_at < v_end;

  -- Derived metrics
  v_row.gross_profit_halala := v_row.total_revenue_halala - v_row.total_cogs_halala - v_row.total_refunds_halala;
  v_row.reward_spend_halala := v_row.commission_paid_halala + v_row.spinner_cost_halala;
  v_row.date := p_date;

  INSERT INTO daily_metrics (
    date, total_revenue_halala, total_orders_count,
    total_cogs_halala, total_refunds_halala, total_refunds_count,
    referred_orders_count, referred_revenue_halala,
    new_referrals_count, qualified_referrals_count,
    commission_paid_halala, spinner_cost_halala,
    spins_granted_count, spins_used_count,
    coupons_issued_count, coupons_redeemed_count,
    wallet_credits_halala, wallet_debits_halala,
    gross_profit_halala, reward_spend_halala
  ) VALUES (
    v_row.date, v_row.total_revenue_halala, v_row.total_orders_count,
    v_row.total_cogs_halala, v_row.total_refunds_halala, v_row.total_refunds_count,
    v_row.referred_orders_count, v_row.referred_revenue_halala,
    v_row.new_referrals_count, v_row.qualified_referrals_count,
    v_row.commission_paid_halala, v_row.spinner_cost_halala,
    v_row.spins_granted_count, v_row.spins_used_count,
    v_row.coupons_issued_count, v_row.coupons_redeemed_count,
    v_row.wallet_credits_halala, v_row.wallet_debits_halala,
    v_row.gross_profit_halala, v_row.reward_spend_halala
  );

  RETURN jsonb_build_object(
    'status', 'ok', 'date', p_date,
    'revenue', v_row.total_revenue_halala,
    'cogs', v_row.total_cogs_halala,
    'gross_profit', v_row.gross_profit_halala,
    'reward_spend', v_row.reward_spend_halala
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- UPDATED WEEKLY ADJUSTMENT with prize weight adjustment
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION weekly_adjust_rewards()
RETURNS jsonb AS $$
DECLARE
  v_settings referral_settings%ROWTYPE;
  v_spend_ratio numeric(5,3);
  v_rolling_revenue int;
  v_rolling_cogs int;
  v_rolling_refunds int;
  v_rolling_gross_profit int;
  v_rolling_reward_spend int;
  v_target_reward_spend int;
  v_daily_pool int;
  v_new_commission int;
  v_new_spin_cap int;
  v_new_top_prize_cost int;
  v_reason text;
  v_flagged boolean := false;
  v_prize_adjustments jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_settings FROM referral_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'settings_not_found');
  END IF;

  IF NOT v_settings.adaptive_enabled THEN
    RETURN jsonb_build_object('status', 'adaptive_disabled');
  END IF;

  IF EXTRACT(DOW FROM now()) != v_settings.adjustment_day_of_week THEN
    RETURN jsonb_build_object('status', 'not_adjustment_day');
  END IF;

  -- 7-day rolling
  SELECT
    COALESCE(SUM(total_revenue_halala), 0),
    COALESCE(SUM(total_cogs_halala), 0),
    COALESCE(SUM(total_refunds_halala), 0),
    COALESCE(SUM(reward_spend_halala), 0)
  INTO v_rolling_revenue, v_rolling_cogs, v_rolling_refunds, v_rolling_reward_spend
  FROM daily_metrics
  WHERE date >= CURRENT_DATE - interval '7 days' AND date < CURRENT_DATE;

  v_rolling_gross_profit := v_rolling_revenue - v_rolling_cogs - v_rolling_refunds;
  v_daily_pool := (v_rolling_gross_profit * v_settings.reward_budget_pct / 100 / 7)::int;
  v_target_reward_spend := v_daily_pool * 7;

  IF v_target_reward_spend > 0 THEN
    v_spend_ratio := v_rolling_reward_spend::numeric / v_target_reward_spend;
  ELSE
    v_spend_ratio := 0;
  END IF;

  v_new_commission := v_settings.first_purchase_percent;
  v_new_spin_cap := v_settings.max_spins_per_week;
  v_new_top_prize_cost := v_settings.top_prize_cost_halala;

  IF v_spend_ratio > 1.5 THEN
    v_new_commission := v_new_commission - 1;
    v_new_spin_cap := GREATEST(1, v_new_spin_cap - 1);
    v_new_top_prize_cost := GREATEST(v_settings.guardrail_prize_cost_min, v_new_top_prize_cost - 10000);
    v_reason := format('DANGER: Spend ratio %.2f > 1.5x. Tightening commission, spin cap, and top prize.', v_spend_ratio);
    v_flagged := true;

    -- Also reduce top prize weight by 20%
    UPDATE spinner_prizes
    SET weight = GREATEST(1, weight * 0.8)
    WHERE prize_type IN ('coupon_percent', 'free_product')
      AND value >= 25
      AND is_active = true;

  ELSIF v_spend_ratio > 1.1 THEN
    v_new_commission := v_new_commission - 1;
    v_reason := format('Overspending: Spend ratio %.2f > 1.1x. Lowering commission by 1%%.', v_spend_ratio);

  ELSIF v_spend_ratio < 0.5 THEN
    v_new_commission := v_new_commission + 1;
    v_new_top_prize_cost := LEAST(v_settings.guardrail_prize_cost_max, v_new_top_prize_cost + 10000);
    v_reason := format('Underspending: Spend ratio %.2f < 0.5x. Raising commission and top prize cost.', v_spend_ratio);

    -- Increase top prize weight by 15%
    UPDATE spinner_prizes
    SET weight = LEAST(50, weight * 1.15)
    WHERE prize_type IN ('coupon_percent', 'free_product')
      AND value >= 25
      AND is_active = true;

  ELSE
    v_reason := format('Steady: Spend ratio %.2f in target range. No changes.', v_spend_ratio);
  END IF;

  -- Clamp to guardrails
  v_new_commission := GREATEST(v_settings.guardrail_commission_min, LEAST(v_settings.guardrail_commission_max, v_new_commission));
  v_new_spin_cap := GREATEST(v_settings.guardrail_spin_cap_min, LEAST(v_settings.guardrail_spin_cap_max, v_new_spin_cap));
  v_new_top_prize_cost := GREATEST(v_settings.guardrail_prize_cost_min, LEAST(v_settings.guardrail_prize_cost_max, v_new_top_prize_cost));

  -- Log
  INSERT INTO adjustment_log (
    date, trigger_type, spend_ratio,
    old_commission_pct, old_weekly_spin_cap, old_top_prize_cost_halala, old_reward_budget_pct,
    new_commission_pct, new_weekly_spin_cap, new_top_prize_cost_halala, new_reward_budget_pct,
    rolling_revenue_7d, rolling_cogs_7d, rolling_refunds_7d,
    rolling_gross_profit_7d, rolling_reward_spend_7d, target_reward_spend_7d,
    reason, flagged_for_review
  ) VALUES (
    CURRENT_DATE, 'weekly_auto', v_spend_ratio,
    v_settings.first_purchase_percent, v_settings.max_spins_per_week, v_settings.top_prize_cost_halala, v_settings.reward_budget_pct,
    v_new_commission, v_new_spin_cap, v_new_top_prize_cost, v_settings.reward_budget_pct,
    v_rolling_revenue, v_rolling_cogs, v_rolling_refunds,
    v_rolling_gross_profit, v_rolling_reward_spend, v_target_reward_spend,
    v_reason, v_flagged
  );

  -- Update live settings
  IF v_new_commission != v_settings.first_purchase_percent
     OR v_new_spin_cap != v_settings.max_spins_per_week
     OR v_new_top_prize_cost != v_settings.top_prize_cost_halala THEN
    UPDATE referral_settings
    SET first_purchase_percent = v_new_commission,
        max_spins_per_week = v_new_spin_cap,
        top_prize_cost_halala = v_new_top_prize_cost,
        last_adjustment_date = CURRENT_DATE,
        updated_at = now()
    WHERE id = '00000000-0000-0000-0000-000000000001';
  END IF;

  -- Update yesterday's metrics with ratio
  UPDATE daily_metrics
  SET reward_budget_pct = v_settings.reward_budget_pct,
      spend_ratio = v_spend_ratio
  WHERE date = CURRENT_DATE - 1;

  RETURN jsonb_build_object(
    'status', 'ok',
    'spend_ratio', v_spend_ratio,
    'old_commission', v_settings.first_purchase_percent,
    'new_commission', v_new_commission,
    'old_spin_cap', v_settings.max_spins_per_week,
    'new_spin_cap', v_new_spin_cap,
    'old_top_prize_cost', v_settings.top_prize_cost_halala,
    'new_top_prize_cost', v_new_top_prize_cost,
    'rolling_gross_profit', v_rolling_gross_profit,
    'rolling_reward_spend', v_rolling_reward_spend,
    'target_reward_spend', v_target_reward_spend,
    'reason', v_reason,
    'flagged', v_flagged,
    'prize_adjustments', v_prize_adjustments
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- DAILY SPEND CAP CHECK
-- Returns true if daily reward spend is within cap
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_daily_spend_cap()
RETURNS jsonb AS $$
DECLARE
  v_settings referral_settings%ROWTYPE;
  v_today_spend int;
  v_cap int;
BEGIN
  SELECT * INTO v_settings FROM referral_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  IF NOT FOUND OR NOT v_settings.daily_spend_cap_enabled THEN
    RETURN jsonb_build_object('cap_active', false);
  END IF;

  -- Calculate dynamic cap from rolling average if static cap is 0
  IF v_settings.daily_spend_cap_halala > 0 THEN
    v_cap := v_settings.daily_spend_cap_halala;
  ELSE
    -- Dynamic: 120% of average daily pool as hard cap
    DECLARE v_rolling_profit int;
    BEGIN
      SELECT COALESCE(SUM(gross_profit_halala), 0) INTO v_rolling_profit
      FROM daily_metrics WHERE date >= CURRENT_DATE - interval '7 days' AND date < CURRENT_DATE;
      v_cap := (v_rolling_profit * v_settings.reward_budget_pct / 100 / 7 * 1.2)::int;
    END;
  END IF;

  -- Today's actual spend so far
  SELECT COALESCE(SUM(amount_halala), 0) INTO v_today_spend
  FROM referral_rewards
  WHERE created_at >= CURRENT_DATE;

  -- Add spinner costs today
  DECLARE v_spin_cost int;
  BEGIN
    SELECT COALESCE(SUM(sp.value), 0) INTO v_spin_cost
    FROM spinner_spins ss
    JOIN spinner_prizes sp ON sp.id = ss.won_prize_id
    WHERE ss.status = 'used'
      AND ss.won_at >= CURRENT_DATE
      AND sp.prize_type != 'spin_again';
    v_today_spend := v_today_spend + COALESCE(v_spin_cost, 0);
  END;

  RETURN jsonb_build_object(
    'cap_active', true,
    'daily_cap', v_cap,
    'today_spend', v_today_spend,
    'remaining', GREATEST(0, v_cap - v_today_spend),
    'exceeded', v_today_spend >= v_cap
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- COMMISSION REVERSAL
-- Called when a referred order is refunded
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_commission(
  p_order_id uuid,
  p_reason text DEFAULT 'Order refunded'
) RETURNS jsonb AS $$
DECLARE
  v_referral referrals%ROWTYPE;
  v_reward referral_rewards%ROWTYPE;
  v_reversed int := 0;
BEGIN
  -- Find the referral for this order's buyer
  SELECT r INTO v_referral
  FROM referrals r
  JOIN orders o ON o.profile_id = r.referred_id
  WHERE o.id = p_order_id AND r.status = 'qualified';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_referral_found');
  END IF;

  -- Find the commission reward for this referral
  SELECT rr INTO v_reward
  FROM referral_rewards rr
  WHERE rr.referral_id = v_referral.id
    AND rr.reward_type = 'commission'
    AND (rr.metadata->>'order_id')::uuid = p_order_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_commission_found');
  END IF;

  -- Check if already reversed
  IF EXISTS (
    SELECT 1 FROM commission_reversals
    WHERE referral_id = v_referral.id AND order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('status', 'already_reversed');
  END IF;

  -- Debit from referrer's wallet
  PERFORM debit_wallet(
    v_referral.referrer_id,
    v_reward.amount_halala,
    format('Commission reversed for order %s', p_order_id),
    'commission_reversal',
    v_referral.id
  );

  -- Log the reversal
  INSERT INTO commission_reversals (referral_id, order_id, amount_halala, reason)
  VALUES (v_referral.id, p_order_id, v_reward.amount_halala, p_reason);

  v_reversed := v_reward.amount_halala;

  RETURN jsonb_build_object(
    'status', 'reversed',
    'amount_halala', v_reversed,
    'referrer_id', v_referral.referrer_id
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- DATA RETENTION: clean metrics older than 90 days
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_old_metrics()
RETURNS jsonb AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM daily_metrics
  WHERE date < CURRENT_DATE - interval '90 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Also clean old adjustment logs (keep 180 days)
  DELETE FROM adjustment_log
  WHERE date < CURRENT_DATE - interval '180 days';

  RETURN jsonb_build_object(
    'status', 'ok',
    'metrics_deleted', v_deleted,
    'cleaned_at', now()
  );
END;
$$ LANGUAGE plpgsql;
