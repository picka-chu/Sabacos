import type { Db } from "./client.js";

// ──────────────────────────────────────────────────────────────────────
// Daily Metrics
// ──────────────────────────────────────────────────────────────────────

export interface DailyMetrics {
  id: string;
  date: string;
  totalRevenueHalala: number;
  totalOrdersCount: number;
  totalCogsHalala: number;
  totalRefundsHalala: number;
  totalRefundsCount: number;
  referredOrdersCount: number;
  referredRevenueHalala: number;
  newReferralsCount: number;
  qualifiedReferralsCount: number;
  commissionPaidHalala: number;
  spinnerCostHalala: number;
  spinsGrantedCount: number;
  spinsUsedCount: number;
  couponsIssuedCount: number;
  couponsRedeemedCount: number;
  walletCreditsHalala: number;
  walletDebitsHalala: number;
  grossProfitHalala: number;
  rewardSpendHalala: number;
  rewardBudgetPct: number | null;
  spendRatio: number | null;
  createdAt: string;
}

/** Aggregate metrics for a given date using the RPC function. */
export async function aggregateDailyMetrics(
  db: Db,
  date: string,
): Promise<{ status: string; date: string; revenue?: number; grossProfit?: number; rewardSpend?: number }> {
  const { data, error } = await db.rpc("aggregate_daily_metrics", { p_date: date });
  if (error) throw new Error(`aggregateDailyMetrics: ${error.message}`);
  return data;
}

/** Get daily metrics for a date range. */
export async function getDailyMetrics(
  db: Db,
  options: { startDate?: string; endDate?: string; limit?: number } = {},
): Promise<DailyMetrics[]> {
  const { startDate, endDate, limit = 30 } = options;

  let query = db.from("daily_metrics").select("*").order("date", { ascending: false });

  if (startDate) query = query.gte("date", startDate);
  if (endDate) query = query.lte("date", endDate);
  query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`getDailyMetrics: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    totalRevenueHalala: r.total_revenue_halala,
    totalOrdersCount: r.total_orders_count,
    totalCogsHalala: r.total_cogs_halala,
    totalRefundsHalala: r.total_refunds_halala,
    totalRefundsCount: r.total_refunds_count,
    referredOrdersCount: r.referred_orders_count,
    referredRevenueHalala: r.referred_revenue_halala,
    newReferralsCount: r.new_referrals_count,
    qualifiedReferralsCount: r.qualified_referrals_count,
    commissionPaidHalala: r.commission_paid_halala,
    spinnerCostHalala: r.spinner_cost_halala,
    spinsGrantedCount: r.spins_granted_count,
    spinsUsedCount: r.spins_used_count,
    couponsIssuedCount: r.coupons_issued_count,
    couponsRedeemedCount: r.coupons_redeemed_count,
    walletCreditsHalala: r.wallet_credits_halala,
    walletDebitsHalala: r.wallet_debits_halala,
    grossProfitHalala: r.gross_profit_halala,
    rewardSpendHalala: r.reward_spend_halala,
    rewardBudgetPct: r.reward_budget_pct,
    spendRatio: r.spend_ratio,
    createdAt: r.created_at,
  }));
}

/** Get the latest daily metrics row. */
export async function getLatestMetrics(db: Db): Promise<DailyMetrics | null> {
  const { data, error } = await db
    .from("daily_metrics")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    date: data.date,
    totalRevenueHalala: data.total_revenue_halala,
    totalOrdersCount: data.total_orders_count,
    totalCogsHalala: data.total_cogs_halala,
    totalRefundsHalala: data.total_refunds_halala,
    totalRefundsCount: data.total_refunds_count,
    referredOrdersCount: data.referred_orders_count,
    referredRevenueHalala: data.referred_revenue_halala,
    newReferralsCount: data.new_referrals_count,
    qualifiedReferralsCount: data.qualified_referrals_count,
    commissionPaidHalala: data.commission_paid_halala,
    spinnerCostHalala: data.spinner_cost_halala,
    spinsGrantedCount: data.spins_granted_count,
    spinsUsedCount: data.spins_used_count,
    couponsIssuedCount: data.coupons_issued_count,
    couponsRedeemedCount: data.coupons_redeemed_count,
    walletCreditsHalala: data.wallet_credits_halala,
    walletDebitsHalala: data.wallet_debits_halala,
    grossProfitHalala: data.gross_profit_halala,
    rewardSpendHalala: data.reward_spend_halala,
    rewardBudgetPct: data.reward_budget_pct,
    spendRatio: data.spend_ratio,
    createdAt: data.created_at,
  };
}

/** Calculate 7-day rolling averages from daily_metrics. */
export async function getRollingAverages(db: Db): Promise<{
  rollingRevenue7d: number;
  rollingCogs7d: number;
  rollingRefunds7d: number;
  rollingGrossProfit7d: number;
  rollingRewardSpend7d: number;
  targetRewardSpend7d: number;
  dailyPool: number;
  spendRatio: number;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const { data, error } = await db
    .from("daily_metrics")
    .select("total_revenue_halala, total_cogs_halala, total_refunds_halala, reward_spend_halala, reward_budget_pct")
    .gte("date", sevenDaysAgo)
    .order("date", { ascending: false });

  if (error) throw new Error(`getRollingAverages: ${error.message}`);

  const rows = data ?? [];
  const rollingRevenue7d = rows.reduce((sum, r) => sum + (r.total_revenue_halala ?? 0), 0);
  const rollingCogs7d = rows.reduce((sum, r) => sum + (r.total_cogs_halala ?? 0), 0);
  const rollingRefunds7d = rows.reduce((sum, r) => sum + (r.total_refunds_halala ?? 0), 0);
  const rollingGrossProfit7d = rollingRevenue7d - rollingCogs7d - rollingRefunds7d;
  const rollingRewardSpend7d = rows.reduce((sum, r) => sum + (r.reward_spend_halala ?? 0), 0);

  // Use the most recent budget % or default 15%
  const latestBudgetPct = rows[0]?.reward_budget_pct ?? 15;
  const dailyPool = Math.floor((rollingGrossProfit7d * Number(latestBudgetPct)) / 100 / 7);
  const targetRewardSpend7d = dailyPool * 7;

  const spendRatio = targetRewardSpend7d > 0 ? rollingRewardSpend7d / targetRewardSpend7d : 0;

  return {
    rollingRevenue7d,
    rollingCogs7d,
    rollingRefunds7d,
    rollingGrossProfit7d,
    rollingRewardSpend7d,
    targetRewardSpend7d,
    dailyPool,
    spendRatio,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Adjustment Log
// ──────────────────────────────────────────────────────────────────────

export interface AdjustmentLogEntry {
  id: string;
  date: string;
  triggerType: string;
  spendRatio: number | null;
  oldCommissionPct: number | null;
  oldWeeklySpinCap: number | null;
  oldTopPrizeCostHalala: number | null;
  oldRewardBudgetPct: number | null;
  newCommissionPct: number | null;
  newWeeklySpinCap: number | null;
  newTopPrizeCostHalala: number | null;
  newRewardBudgetPct: number | null;
  rollingRevenue7d: number | null;
  rollingCogs7d: number | null;
  rollingRefunds7d: number | null;
  rollingGrossProfit7d: number | null;
  rollingRewardSpend7d: number | null;
  targetRewardSpend7d: number | null;
  reason: string | null;
  flaggedForReview: boolean;
  createdAt: string;
}

/** Get adjustment log entries. */
export async function getAdjustmentLog(
  db: Db,
  options: { limit?: number; flaggedOnly?: boolean } = {},
): Promise<AdjustmentLogEntry[]> {
  const { limit = 50, flaggedOnly = false } = options;

  let query = db
    .from("adjustment_log")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);

  if (flaggedOnly) query = query.eq("flagged_for_review", true);

  const { data, error } = await query;
  if (error) throw new Error(`getAdjustmentLog: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    triggerType: r.trigger_type,
    spendRatio: r.spend_ratio,
    oldCommissionPct: r.old_commission_pct,
    oldWeeklySpinCap: r.old_weekly_spin_cap,
    oldTopPrizeCostHalala: r.old_top_prize_cost_halala,
    oldRewardBudgetPct: r.old_reward_budget_pct,
    newCommissionPct: r.new_commission_pct,
    newWeeklySpinCap: r.new_weekly_spin_cap,
    newTopPrizeCostHalala: r.new_top_prize_cost_halala,
    newRewardBudgetPct: r.new_reward_budget_pct,
    rollingRevenue7d: r.rolling_revenue_7d,
    rollingCogs7d: r.rolling_cogs_7d,
    rollingRefunds7d: r.rolling_refunds_7d,
    rollingGrossProfit7d: r.rolling_gross_profit_7d,
    rollingRewardSpend7d: r.rolling_reward_spend_7d,
    targetRewardSpend7d: r.target_reward_spend_7d,
    reason: r.reason,
    flaggedForReview: r.flagged_for_review,
    createdAt: r.created_at,
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Adaptive Engine Jobs
// ──────────────────────────────────────────────────────────────────────

/** Run the nightly aggregation job. Aggregates yesterday's metrics. */
export async function runNightlyAggregation(db: Db): Promise<{ status: string; date: string }> {
  // Aggregate yesterday (the most recent complete day)
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const result = await aggregateDailyMetrics(db, yesterday);
  return { status: result.status, date: yesterday };
}

/** Run the weekly adjustment job. Returns the adjustment result. */
export async function runWeeklyAdjustment(db: Db): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("weekly_adjust_rewards");
  if (error) throw new Error(`runWeeklyAdjustment: ${error.message}`);
  return data;
}

/** Manually override a setting (logged to adjustment_log). */
export async function manualAdjustment(
  db: Db,
  params: {
    commissionPct?: number;
    weeklySpinCap?: number;
    topPrizeCostHalala?: number;
    rewardBudgetPct?: number;
    reason: string;
  },
): Promise<void> {
  // Get current settings
  const { data: current } = await db
    .from("referral_settings")
    .select("*")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .single();

  if (!current) throw new Error("Settings not found");

  // Log the change
  await db.from("adjustment_log").insert({
    date: new Date().toISOString().split("T")[0],
    trigger_type: "manual",
    spend_ratio: null,
    old_commission_pct: current.first_purchase_percent,
    old_weekly_spin_cap: current.max_spins_per_week,
    old_top_prize_cost_halala: current.top_prize_cost_halala,
    old_reward_budget_pct: current.reward_budget_pct,
    new_commission_pct: params.commissionPct ?? current.first_purchase_percent,
    new_weekly_spin_cap: params.weeklySpinCap ?? current.max_spins_per_week,
    new_top_prize_cost_halala: params.topPrizeCostHalala ?? current.top_prize_cost_halala,
    new_reward_budget_pct: params.rewardBudgetPct ?? current.reward_budget_pct,
    reason: params.reason,
    flagged_for_review: false,
  });

  // Apply the change
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.commissionPct !== undefined) updates.first_purchase_percent = params.commissionPct;
  if (params.weeklySpinCap !== undefined) updates.max_spins_per_week = params.weeklySpinCap;
  if (params.topPrizeCostHalala !== undefined) updates.top_prize_cost_halala = params.topPrizeCostHalala;
  if (params.rewardBudgetPct !== undefined) updates.reward_budget_pct = params.rewardBudgetPct;

  await db
    .from("referral_settings")
    .update(updates)
    .eq("id", "00000000-0000-0000-0000-000000000001");
}

/** Toggle adaptive engine on/off. */
export async function setAdaptiveEnabled(db: Db, enabled: boolean): Promise<void> {
  const { error } = await db
    .from("referral_settings")
    .update({ adaptive_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", "00000000-0000-0000-0000-000000000001");

  if (error) throw new Error(`setAdaptiveEnabled: ${error.message}`);
}

/** Update guardrails. */
export async function updateGuardrails(
  db: Db,
  guardrails: {
    commissionMin?: number;
    commissionMax?: number;
    spinCapMin?: number;
    spinCapMax?: number;
    prizeCostMin?: number;
    prizeCostMax?: number;
    maxBudgetPct?: number;
  },
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (guardrails.commissionMin !== undefined) updates.guardrail_commission_min = guardrails.commissionMin;
  if (guardrails.commissionMax !== undefined) updates.guardrail_commission_max = guardrails.commissionMax;
  if (guardrails.spinCapMin !== undefined) updates.guardrail_spin_cap_min = guardrails.spinCapMin;
  if (guardrails.spinCapMax !== undefined) updates.guardrail_spin_cap_max = guardrails.spinCapMax;
  if (guardrails.prizeCostMin !== undefined) updates.guardrail_prize_cost_min = guardrails.prizeCostMin;
  if (guardrails.prizeCostMax !== undefined) updates.guardrail_prize_cost_max = guardrails.prizeCostMax;
  if (guardrails.maxBudgetPct !== undefined) updates.guardrail_max_budget_pct = guardrails.maxBudgetPct;

  const { error } = await db
    .from("referral_settings")
    .update(updates)
    .eq("id", "00000000-0000-0000-0000-000000000001");

  if (error) throw new Error(`updateGuardrails: ${error.message}`);
}
