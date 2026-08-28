-- 0012: Adaptive Referral Reward Engine
-- Tables: daily_metrics, adjustment_log
-- Updates: referral_settings gains adaptive fields

-- ──────────────────────────────────────────────────────────────────────
-- DAILY METRICS
-- One row per calendar day, aggregated from raw events
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_metrics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date            date NOT NULL UNIQUE,               -- calendar date (UTC)

  -- Revenue
  total_revenue_halala     int NOT NULL DEFAULT 0,     -- all orders (paid)
  total_orders_count       int NOT NULL DEFAULT 0,

  -- Costs
  total_cogs_halala        int NOT NULL DEFAULT 0,     -- cost of goods sold
  total_refunds_halala     int NOT NULL DEFAULT 0,     -- refunded order totals
  total_refunds_count      int NOT NULL DEFAULT 0,

  -- Referral activity
  referred_orders_count    int NOT NULL DEFAULT 0,     -- orders from referred users
  referred_revenue_halala  int NOT NULL DEFAULT 0,     -- revenue from referred users
  new_referrals_count      int NOT NULL DEFAULT 0,     -- new referral links created
  qualified_referrals_count int NOT NULL DEFAULT 0,    -- referrals that qualified (first purchase)

  -- Reward spend
  commission_paid_halala   int NOT NULL DEFAULT 0,     -- wallet credits issued as commission
  spinner_cost_halala      int NOT NULL DEFAULT 0,     -- cost of spinner prizes redeemed
  spins_granted_count      int NOT NULL DEFAULT 0,
  spins_used_count         int NOT NULL DEFAULT 0,
  coupons_issued_count     int NOT NULL DEFAULT 0,
  coupons_redeemed_count   int NOT NULL DEFAULT 0,

  -- Wallet
  wallet_credits_halala    int NOT NULL DEFAULT 0,     -- total credits issued (any source)
  wallet_debits_halala     int NOT NULL DEFAULT 0,     -- total debits (coupon redemptions)

  -- Derived (computed by aggregation job)
  gross_profit_halala      int NOT NULL DEFAULT 0,     -- revenue - cogs - refunds
  reward_spend_halala      int NOT NULL DEFAULT 0,     -- commission + spinner cost
  reward_budget_pct        numeric(5,2),               -- snapshot of reward_budget_pct used
  spend_ratio              numeric(5,3),               -- reward_spend / reward_budget for this day

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_metrics_date ON daily_metrics(date DESC);

-- ──────────────────────────────────────────────────────────────────────
-- ADJUSTMENT LOG
-- Full audit trail of every automated or manual config change
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adjustment_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date NOT NULL,                         -- the date this adjustment was made
  trigger_type  text NOT NULL CHECK (trigger_type IN ('weekly_auto', 'manual', 'danger_override')),
  spend_ratio   numeric(5,3),                          -- the spend ratio that drove the decision

  -- Old values
  old_commission_pct      int,
  old_weekly_spin_cap     int,
  old_top_prize_cost_halala int,
  old_reward_budget_pct   numeric(5,2),

  -- New values
  new_commission_pct      int,
  new_weekly_spin_cap     int,
  new_top_prize_cost_halala int,
  new_reward_budget_pct   numeric(5,2),

  -- Context
  rolling_revenue_7d      int,
  rolling_cogs_7d         int,
  rolling_refunds_7d      int,
  rolling_gross_profit_7d int,
  rolling_reward_spend_7d int,
  target_reward_spend_7d  int,

  reason          text,                                -- human-readable explanation
  flagged_for_review boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_adjustment_log_date ON adjustment_log(date DESC);

-- ──────────────────────────────────────────────────────────────────────
-- Update referral_settings with adaptive engine fields
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE referral_settings
  ADD COLUMN IF NOT EXISTS reward_budget_pct numeric(5,2) NOT NULL DEFAULT 15.00,
  ADD COLUMN IF NOT EXISTS top_prize_cost_halala int NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS adaptive_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_adjustment_date date,
  ADD COLUMN IF NOT EXISTS adjustment_day_of_week int NOT NULL DEFAULT 1; -- 1=Monday

-- ──────────────────────────────────────────────────────────────────────
-- GUARDRAILS (stored in referral_settings for transparency)
-- These are the hard limits the adaptive engine cannot exceed
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE referral_settings
  ADD COLUMN IF NOT EXISTS guardrail_commission_min int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS guardrail_commission_max int NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS guardrail_spin_cap_min int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS guardrail_spin_cap_max int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS guardrail_prize_cost_min int NOT NULL DEFAULT 30000,
  ADD COLUMN IF NOT EXISTS guardrail_prize_cost_max int NOT NULL DEFAULT 150000,
  ADD COLUMN IF NOT EXISTS guardrail_max_budget_pct numeric(5,2) NOT NULL DEFAULT 25.00;

-- ──────────────────────────────────────────────────────────────────────
-- RPC: Aggregate daily metrics from raw events
-- Called nightly by cron job
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION aggregate_daily_metrics(p_date date)
RETURNS jsonb AS $$
DECLARE
  v_start timestamptz := p_date;
  v_end   timestamptz := p_date + interval '1 day';
  v_row   daily_metrics%ROWTYPE;
BEGIN
  -- Check if already aggregated
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

  -- Refunds
  SELECT
    COALESCE(SUM(total_halala), 0),
    COUNT(*)
  INTO v_row.total_refunds_halala, v_row.total_refunds_count
  FROM orders
  WHERE status = 'cancelled'
    AND payment_status = 'refunded'
    AND updated_at >= v_start AND updated_at < v_end;

  -- COGS: sum of (product cost * qty) for delivered/processing/shipped orders
  -- We approximate using a percentage of revenue if no cost data available
  -- For now, use 40% of revenue as default COGS (adjust based on your margins)
  v_row.total_cogs_halala := v_row.total_revenue_halala * 40 / 100;

  -- Referral activity
  SELECT
    COUNT(*)
  INTO v_row.new_referrals_count
  FROM referrals
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT
    COUNT(*)
  INTO v_row.qualified_referrals_count
  FROM referrals
  WHERE status = 'qualified'
    AND qualified_at >= v_start AND qualified_at < v_end;

  -- Referred orders (orders where the buyer has a qualified referral)
  SELECT
    COUNT(*),
    COALESCE(SUM(o.total_halala), 0)
  INTO v_row.referred_orders_count, v_row.referred_revenue_halala
  FROM orders o
  JOIN referrals r ON r.referred_id = o.profile_id
  WHERE r.status = 'qualified'
    AND o.status NOT IN ('cancelled', 'pending_payment')
    AND o.created_at >= v_start AND o.created_at < v_end;

  -- Commission paid out
  SELECT
    COALESCE(SUM(amount_halala), 0)
  INTO v_row.commission_paid_halala
  FROM referral_rewards
  WHERE reward_type = 'commission'
    AND created_at >= v_start AND created_at < v_end;

  -- Spinner activity
  SELECT
    COUNT(*)
  INTO v_row.spins_granted_count
  FROM spinner_spins
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT
    COUNT(*)
  INTO v_row.spins_used_count
  FROM spinner_spins
  WHERE status = 'used'
    AND won_at >= v_start AND won_at < v_end;

  -- Spinner cost: sum of prize values for used spins
  SELECT
    COALESCE(SUM(sp.value), 0)
  INTO v_row.spinner_cost_halala
  FROM spinner_spins ss
  JOIN spinner_prizes sp ON sp.id = ss.won_prize_id
  WHERE ss.status = 'used'
    AND ss.won_at >= v_start AND ss.won_at < v_end
    AND sp.prize_type != 'spin_again';

  -- Coupons
  SELECT
    COUNT(*)
  INTO v_row.coupons_issued_count
  FROM spinner_coupons
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT
    COUNT(*)
  INTO v_row.coupons_redeemed_count
  FROM spinner_coupons
  WHERE is_used = true
    AND used_at >= v_start AND used_at < v_end;

  -- Wallet activity
  SELECT
    COALESCE(SUM(amount_halala), 0)
  INTO v_row.wallet_credits_halala
  FROM wallet_transactions
  WHERE type IN ('credit', 'refund')
    AND created_at >= v_start AND created_at < v_end;

  SELECT
    COALESCE(SUM(amount_halala), 0)
  INTO v_row.wallet_debits_halala
  FROM wallet_transactions
  WHERE type = 'debit'
    AND created_at >= v_start AND created_at < v_end;

  -- Derived metrics
  v_row.gross_profit_halala := v_row.total_revenue_halala - v_row.total_cogs_halala - v_row.total_refunds_halala;
  v_row.reward_spend_halala := v_row.commission_paid_halala + v_row.spinner_cost_halala;
  v_row.date := p_date;

  -- Insert the row
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
    'status', 'ok',
    'date', p_date,
    'revenue', v_row.total_revenue_halala,
    'gross_profit', v_row.gross_profit_halala,
    'reward_spend', v_row.reward_spend_halala
  );
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────
-- RPC: Weekly adjustment algorithm
-- Called weekly by cron job (e.g., Monday 00:00 UTC)
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
BEGIN
  -- Get current settings
  SELECT * INTO v_settings FROM referral_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'settings_not_found');
  END IF;

  IF NOT v_settings.adaptive_enabled THEN
    RETURN jsonb_build_object('status', 'adaptive_disabled');
  END IF;

  -- Check if today is the adjustment day
  IF EXTRACT(DOW FROM now()) != v_settings.adjustment_day_of_week THEN
    RETURN jsonb_build_object('status', 'not_adjustment_day', 'day_of_week', v_settings.adjustment_day_of_week);
  END IF;

  -- Calculate 7-day rolling averages
  SELECT
    COALESCE(SUM(total_revenue_halala), 0),
    COALESCE(SUM(total_cogs_halala), 0),
    COALESCE(SUM(total_refunds_halala), 0),
    COALESCE(SUM(reward_spend_halala), 0)
  INTO v_rolling_revenue, v_rolling_cogs, v_rolling_refunds, v_rolling_reward_spend
  FROM daily_metrics
  WHERE date >= CURRENT_DATE - interval '7 days'
    AND date < CURRENT_DATE;

  v_rolling_gross_profit := v_rolling_revenue - v_rolling_cogs - v_rolling_refunds;

  -- Calculate target spend
  v_daily_pool := (v_rolling_gross_profit * v_settings.reward_budget_pct / 100 / 7)::int;
  v_target_reward_spend := v_daily_pool * 7;

  -- Calculate spend ratio
  IF v_target_reward_spend > 0 THEN
    v_spend_ratio := v_rolling_reward_spend::numeric / v_target_reward_spend;
  ELSE
    v_spend_ratio := 0;
  END IF;

  -- Start with current values
  v_new_commission := v_settings.first_purchase_percent;
  v_new_spin_cap := v_settings.max_spins_per_week;
  v_new_top_prize_cost := v_settings.top_prize_cost_halala;

  -- Apply adjustment logic
  IF v_spend_ratio > 1.5 THEN
    -- Danger zone: tighten hard
    v_new_commission := v_new_commission - 1;
    v_new_spin_cap := GREATEST(1, v_new_spin_cap - 1);
    v_reason := format('DANGER: Spend ratio %.2f exceeds 1.5x target. Tightening aggressively.', v_spend_ratio);
    v_flagged := true;
  ELSIF v_spend_ratio > 1.1 THEN
    -- Overspending: tighten gently
    v_new_commission := v_new_commission - 1;
    v_reason := format('Overspending: Spend ratio %.2f > 1.1x. Lowering commission by 1%%.', v_spend_ratio);
  ELSIF v_spend_ratio < 0.5 THEN
    -- Underspending: loosen gently
    v_new_commission := v_new_commission + 1;
    v_new_top_prize_cost := v_new_top_prize_cost + 10000;
    v_reason := format('Underspending: Spend ratio %.2f < 0.5x. Raising commission by 1%% and top prize cost.', v_spend_ratio);
  ELSE
    -- 0.5-1.1: hold steady
    v_reason := format('Steady state: Spend ratio %.2f within target range. No changes.', v_spend_ratio);
  END IF;

  -- Clamp to guardrails (the safety net)
  v_new_commission := GREATEST(v_settings.guardrail_commission_min, LEAST(v_settings.guardrail_commission_max, v_new_commission));
  v_new_spin_cap := GREATEST(v_settings.guardrail_spin_cap_min, LEAST(v_settings.guardrail_spin_cap_max, v_new_spin_cap));
  v_new_top_prize_cost := GREATEST(v_settings.guardrail_prize_cost_min, LEAST(v_settings.guardrail_prize_cost_max, v_new_top_prize_cost));

  -- Log the adjustment
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

  -- Update live settings (only if something actually changed)
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

  -- Update daily_metrics with budget snapshot
  UPDATE daily_metrics
  SET reward_budget_pct = v_settings.reward_budget_pct,
      spend_ratio = v_spend_ratio
  WHERE date = CURRENT_DATE - 1; -- yesterday's metrics get the ratio

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
    'flagged', v_flagged
  );
END;
$$ LANGUAGE plpgsql;
