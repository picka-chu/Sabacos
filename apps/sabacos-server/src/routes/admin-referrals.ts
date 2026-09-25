import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import type { AdminContext } from "../auth/admin.js";
import { forbidden } from "../errors.js";
import {
  getReferralSettings,
  updateReferralSettings,
  getReferralsByReferrerId,
  countQualifiedReferrals,
} from "../db/referrals.js";
import {
  getWalletByProfileId,
  creditWallet,
  debitWallet,
  getWalletTransactions,
} from "../db/wallet.js";
import { referralRewardRowSchema } from "@sabacos/core";
import { getAllSpinnerPrizes, createSpinnerPrize, updateSpinnerPrize, deleteSpinnerPrize, getPrizeWinCounts } from "../db/spinner.js";

export const adminReferralRoutes = new Hono<{ Bindings: AppEnv } & AdminContext>();

/**
 * Cash-moving endpoints are admin-only, even if the permission matrix ever
 * grants a lesser role the /referrals page (defense in depth — a staff
 * account must never trigger Chapa transfers or mint wallet balance).
 */
function requireCashAdmin(c: { get: (key: "profile") => { role: string } }): void {
  if (c.get("profile").role !== "admin") {
    throw forbidden("Full admin access required");
  }
}

const walletSchema = z.object({ amountHalala: z.number().int().positive().max(10_000_000) });

const referralSettingsSchema = z.strictObject({
  // Full updatable surface (mirrors SETTINGS_COLUMN_MAP in db/referrals.ts).
  // id/createdAt/updatedAt are accepted-and-ignored (the admin UI round-trips
  // the whole object); anything else 400s instead of silently dropping.
  id: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  isActive: z.boolean().optional(),
  firstPurchasePercent: z.number().min(0).max(100).optional(),
  repeatPurchasePercent: z.number().min(0).max(100).optional(),
  referredDiscountPercent: z.number().min(0).max(100).optional(),
  affiliatePercent: z.number().min(0).max(100).optional(),
  monthlyCapHalala: z.number().int().nonnegative().optional(),
  referralsPerSpin: z.number().int().positive().optional(),
  maxSpinsPerWeek: z.number().int().positive().optional(),
  spinExpiryDays: z.number().int().positive().optional(),
  couponExpiryDays: z.number().int().positive().optional(),
  maxCouponsPerOrder: z.number().int().positive().optional(),
  minAccountAgeDays: z.number().int().nonnegative().optional(),
  minOrderValueHalala: z.number().int().nonnegative().optional(),
  rewardBudgetPct: z.number().min(0).max(100).optional(),
  topPrizeCostHalala: z.number().int().nonnegative().optional(),
  adaptiveEnabled: z.boolean().optional(),
  lastAdjustmentDate: z.string().nullable().optional(),
  adjustmentDayOfWeek: z.number().int().min(0).max(6).optional(),
  dailySpendCapHalala: z.number().int().nonnegative().optional(),
  dailySpendCapEnabled: z.boolean().optional(),
  guardrailCommissionMin: z.number().min(0).max(100).optional(),
  guardrailCommissionMax: z.number().min(0).max(100).optional(),
  guardrailSpinCapMin: z.number().int().nonnegative().optional(),
  guardrailSpinCapMax: z.number().int().nonnegative().optional(),
  guardrailPrizeCostMin: z.number().int().nonnegative().optional(),
  guardrailPrizeCostMax: z.number().int().nonnegative().optional(),
  guardrailMaxBudgetPct: z.number().min(0).max(100).optional(),
});

// ──────────────────────────────────────────────────────────────────────
// Referral Settings
// ──────────────────────────────────────────────────────────────────────

/** GET /admin/referrals/settings — Get referral program settings */
adminReferralRoutes.get("/settings", async (c) => {
  const db = getDb(c.env);
  const settings = await getReferralSettings(db);
  return c.json({ settings });
});

/** PATCH /admin/referrals/settings — Update referral program settings */
adminReferralRoutes.patch("/settings", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  const input = referralSettingsSchema.safeParse(body);
  if (!input.success) {
    return c.json({ error: { code: "bad_request", message: input.error.message } }, 400);
  }

  const settings = await updateReferralSettings(db, input.data);
  return c.json({ settings });
});

// ──────────────────────────────────────────────────────────────────────
// Referral Stats
// ──────────────────────────────────────────────────────────────────────

/** GET /admin/referrals/stats — Get referral program stats */
adminReferralRoutes.get("/stats", async (c) => {
  const db = getDb(c.env);

  // Total referrals
  const { count: totalReferrals } = await db
    .from("referrals")
    .select("*", { count: "exact", head: true });

  // Qualified referrals
  const { count: qualifiedReferrals } = await db
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("status", "qualified");

  // Pending referrals
  const { count: pendingReferrals } = await db
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // Total commissions paid (this month)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data: monthCommissions } = await db
    .from("referral_rewards")
    .select("amount_halala")
    .eq("reward_type", "commission")
    .gte("created_at", monthStart);

  const monthlyCommissionHalala = (monthCommissions ?? []).reduce(
    (sum, r) => sum + (r.amount_halala ?? 0),
    0,
  );

  // Total spins used
  const { count: totalSpinsUsed } = await db
    .from("spinner_spins")
    .select("*", { count: "exact", head: true })
    .eq("status", "used");

  // Total coupons issued
  const { count: totalCoupons } = await db
    .from("spinner_coupons")
    .select("*", { count: "exact", head: true });

  // Total wallet balance across all users
  const { data: walletData } = await db
    .from("wallet_credits")
    .select("balance_halala");

  const totalWalletBalance = (walletData ?? []).reduce(
    (sum, w) => sum + (w.balance_halala ?? 0),
    0,
  );

  return c.json({
    totalReferrals: totalReferrals ?? 0,
    qualifiedReferrals: qualifiedReferrals ?? 0,
    pendingReferrals: pendingReferrals ?? 0,
    monthlyCommissionHalala,
    totalSpinsUsed: totalSpinsUsed ?? 0,
    totalCoupons: totalCoupons ?? 0,
    totalWalletBalance,
  });
});

// ──────────────────────────────────────────────────────────────────────
// Commissions (per-referrer cap review workflow)
// ──────────────────────────────────────────────────────────────────────

/** GET /admin/referrals/commissions?status=pending_review|confirmed&limit= — commission reward rows */
adminReferralRoutes.get("/commissions", async (c) => {
  const db = getDb(c.env);
  const status = c.req.query("status");
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? "50")));

  let query = db
    .from("referral_rewards")
    .select("*")
    .eq("reward_type", "commission")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status === "pending_review" || status === "confirmed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return c.json({ error: { code: "query_failed", message: error.message } }, 500);
  }

  const rewards = (data ?? []).map((row) => referralRewardRowSchema.parse(row));

  // Attach referrer identity for the review checklist.
  const referrerIds = [...new Set(rewards.map((r) => r.referrerId).filter(Boolean))] as string[];
  const referrers = new Map<string, { telegramId: number | null; name: string | null }>();
  if (referrerIds.length > 0) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, telegram_id, first_name, username")
      .in("id", referrerIds);
    for (const p of (profiles ?? []) as Array<{
      id: string; telegram_id?: number | null; first_name?: string | null; username?: string | null;
    }>) {
      referrers.set(p.id, {
        telegramId: p.telegram_id ?? null,
        name: p.first_name ?? p.username ?? null,
      });
    }
  }

  // Per-row cash-out state: aged? reversed? already paid out?
  const now = new Date().toISOString();
  const orderIds = [
    ...new Set(
      rewards
        .map((r) => (r.metadata as Record<string, unknown> | null)?.order_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const rewardIds = rewards.map((r) => r.id);
  const reversedOrderIds = new Set<string>();
  const paidRewardIds = new Set<string>();
  if (orderIds.length > 0) {
    const { data: reversals } = await db
      .from("commission_reversals")
      .select("order_id")
      .in("order_id", orderIds);
    for (const r of (reversals ?? []) as Array<{ order_id: string }>) {
      reversedOrderIds.add(r.order_id);
    }
  }
  if (rewardIds.length > 0 && referrerIds.length > 0) {
    const { data: payouts } = await db
      .from("referral_payouts")
      .select("commission_reward_ids")
      .in("referrer_id", referrerIds)
      .in("status", ["sent", "processing"]);
    for (const p of (payouts ?? []) as Array<{ commission_reward_ids: string[] }>) {
      for (const id of p.commission_reward_ids ?? []) paidRewardIds.add(id);
    }
  }

  return c.json({
    commissions: rewards.map((r) => {
      const orderId =
        ((r.metadata as Record<string, unknown> | null)?.order_id as string) ?? null;
      const agedAt = (data ?? []).find(
        (row) => (row as Record<string, unknown>).id === r.id,
      ) as unknown as { available_for_withdrawal_at?: string | null } | undefined;
      const aged = !!agedAt?.available_for_withdrawal_at && agedAt.available_for_withdrawal_at <= now;
      const reversed = !!orderId && reversedOrderIds.has(orderId);
      const paid = paidRewardIds.has(r.id);
      const withdrawal =
        reversed ? "reversed"
        : paid ? "paid"
        : r.status === "pending_review" ? "review"
        : aged ? "eligible"
        : "aging";
      return {
        ...r,
        orderId,
        agedAt: agedAt?.available_for_withdrawal_at ?? null,
        flags: ((r.metadata as Record<string, unknown> | null)?.flags as string) ?? null,
        withdrawal,
        referrer: r.referrerId ? (referrers.get(r.referrerId) ?? null) : null,
      };
    }),
  });
});

// ──────────────────────────────────────────────────────────────────────
// Payouts (weekly Chapa cash withdrawals)
// ──────────────────────────────────────────────────────────────────────

/** GET /admin/referrals/payouts?status=&limit= — payout attempts, newest first */
adminReferralRoutes.get("/payouts", async (c) => {
  const db = getDb(c.env);
  const status = c.req.query("status");
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? "50")));

  const { listPayouts } = await import("../db/referral-rewards.js");
  const payouts = await listPayouts(
    db,
    status === "pending" || status === "processing" || status === "sent" || status === "failed"
      ? { status, limit }
      : { limit },
  );

  // Attach referrer identity + payout account snapshot for review.
  const referrerIds = [...new Set(payouts.map((p) => p.referrerId))];
  const accountIds = [...new Set(payouts.map((p) => p.payoutAccountId).filter(Boolean))] as string[];
  const referrers = new Map<string, { telegramId: number | null; name: string | null }>();
  const accounts = new Map<string, { accountName: string; accountNumber: string; bankName: string }>();
  if (referrerIds.length > 0) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, telegram_id, first_name, username")
      .in("id", referrerIds);
    for (const p of (profiles ?? []) as Array<{
      id: string; telegram_id?: number | null; first_name?: string | null; username?: string | null;
    }>) {
      referrers.set(p.id, { telegramId: p.telegram_id ?? null, name: p.first_name ?? p.username ?? null });
    }
  }
  if (accountIds.length > 0) {
    const { data: rows } = await db
      .from("referrer_payout_accounts")
      .select("id, account_name, account_number, bank_name")
      .in("id", accountIds);
    for (const a of (rows ?? []) as Array<{
      id: string; account_name: string; account_number: string; bank_name: string;
    }>) {
      accounts.set(a.id, {
        accountName: a.account_name,
        accountNumber: a.account_number,
        bankName: a.bank_name,
      });
    }
  }

  return c.json({
    payouts: payouts.map((p) => ({
      ...p,
      referrer: referrers.get(p.referrerId) ?? null,
      account: p.payoutAccountId ? (accounts.get(p.payoutAccountId) ?? null) : null,
    })),
  });
});

/** POST /admin/referrals/payouts/:id/retry — re-attempt a failed payout (same reference) */
adminReferralRoutes.post("/payouts/:id/retry", async (c) => {
  requireCashAdmin(c);
  const db = getDb(c.env);
  const id = c.req.param("id");
  try {
    const { retryPayout } = await import("../db/referral-rewards.js");
    const payout = await retryPayout(db, c.env, id);
    return c.json({ payout });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed";
    return c.json({ error: { code: "retry_failed", message } }, 400);
  }
});

/**
 * GET /admin/referrals/payout-eligibility — every referrer with commission:
 * total wallet vs. eligible-for-withdrawal, payout weekday, account status.
 * Also flags account_numbers shared across profiles (manual review item).
 */
adminReferralRoutes.get("/payout-eligibility", async (c) => {
  const db = getDb(c.env);
  const { getEligibleWithdrawalAmount, payoutWeekdayName } = await import("../db/referral-rewards.js");

  const { data: rewardRows } = await db
    .from("referral_rewards")
    .select("referrer_id")
    .eq("reward_type", "commission")
    .not("referrer_id", "is", null);
  const referrerIds = [
    ...new Set(((rewardRows ?? []) as Array<{ referrer_id: string }>).map((r) => r.referrer_id)),
  ];

  // Account numbers shared across different profiles (possible duplicate/fraud).
  const { data: accountRows } = await db
    .from("referrer_payout_accounts")
    .select("profile_id, account_number");
  const byNumber = new Map<string, string[]>();
  for (const a of (accountRows ?? []) as Array<{ profile_id: string; account_number: string }>) {
    const list = byNumber.get(a.account_number) ?? [];
    list.push(a.profile_id);
    byNumber.set(a.account_number, list);
  }
  const sharedNumbers = new Set(
    [...byNumber.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([n]) => n),
  );

  const entries: Array<{
    referrerId: string;
    name: string | null;
    telegramId: number | null;
    totalWalletHalala: number;
    eligibleHalala: number;
    payoutWeekday: string;
    hasAccount: boolean;
    accountVerified: boolean;
    sharedAccount: boolean;
  }> = [];
  for (const referrerId of referrerIds) {
    const [{ data: profile }, { data: wallet }, { data: account }] = await Promise.all([
      db.from("profiles").select("first_name, username, telegram_id, created_at").eq("id", referrerId).maybeSingle(),
      db.from("wallet_credits").select("balance_halala").eq("profile_id", referrerId).maybeSingle(),
      db.from("referrer_payout_accounts").select("verified, account_number").eq("profile_id", referrerId).maybeSingle(),
    ]);
    const p = profile as {
      first_name?: string | null; username?: string | null; telegram_id?: number | null; created_at?: string;
    } | null;
    const eligible = await getEligibleWithdrawalAmount(db, referrerId).catch(() => 0);
    entries.push({
      referrerId,
      name: p?.first_name ?? p?.username ?? null,
      telegramId: p?.telegram_id ?? null,
      totalWalletHalala: (wallet as { balance_halala?: number } | null)?.balance_halala ?? 0,
      eligibleHalala: eligible,
      payoutWeekday: p?.created_at ? payoutWeekdayName(p.created_at) : "?",
      hasAccount: !!account,
      accountVerified: (account as { verified?: boolean } | null)?.verified ?? false,
      sharedAccount: account
        ? sharedNumbers.has((account as { account_number: string }).account_number)
        : false,
    });
  }

  entries.sort((a, b) => b.eligibleHalala - a.eligibleHalala);
  // Bank account numbers are sensitive: non-admin roles (if ever granted this
  // page) see only fraud-relevant masking, never full numbers.
  const caller = c.get("profile");
  const mask = (n: string) => (caller.role === "admin" ? n : `••••${n.slice(-4)}`);
  return c.json({
    referrers: entries,
    sharedAccountNumbers: [...sharedNumbers].map(mask),
  });
});

/** PATCH /admin/referrals/payout-accounts/:id — verify/unverify a payout account */
adminReferralRoutes.patch("/payout-accounts/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (typeof body?.verified !== "boolean") {
    return c.json({ error: { code: "bad_request", message: "verified (boolean) required" } }, 400);
  }
  const { setPayoutAccountVerified } = await import("../db/referral-rewards.js");
  const account = await setPayoutAccountVerified(db, id, body.verified);
  return c.json({ account });
});

/** POST /admin/referrals/payouts/run — manually trigger the daily payout pass */
adminReferralRoutes.post("/payouts/run", async (c) => {
  requireCashAdmin(c);
  const db = getDb(c.env);
  const { runWeeklyPayouts } = await import("../db/referral-rewards.js");
  const result = await runWeeklyPayouts(db, c.env);
  return c.json(result);
});

/** POST /admin/referrals/payouts/reconcile — manually trigger the reconcile pass */
adminReferralRoutes.post("/payouts/reconcile", async (c) => {
  requireCashAdmin(c);
  const db = getDb(c.env);
  const { reconcileProcessingPayouts } = await import("../db/referral-rewards.js");
  const result = await reconcileProcessingPayouts(db, c.env);
  return c.json(result);
});

// ──────────────────────────────────────────────────────────────────────
// Spinner Prizes
// ──────────────────────────────────────────────────────────────────────

/** GET /admin/referrals/prizes — Get all spinner prizes (active + inactive) with win counts */
adminReferralRoutes.get("/prizes", async (c) => {
  const db = getDb(c.env);
  const [prizes, winCounts] = await Promise.all([
    getAllSpinnerPrizes(db),
    getPrizeWinCounts(db),
  ]);

  const prizesWithWins = prizes.map((p) => ({
    ...p,
    winCount: winCounts.get(p.id) ?? 0,
  }));

  return c.json({ prizes: prizesWithWins });
});

/** POST /admin/referrals/prizes — Create a new spinner prize */
adminReferralRoutes.post("/prizes", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  if (!body?.name || !body?.prizeType) {
    return c.json({ error: { code: "bad_request", message: "name and prizeType required" } }, 400);
  }

  const prize = await createSpinnerPrize(db, {
    name: body.name,
    prizeType: body.prizeType,
    value: body.value ?? 0,
    productId: body.productId ?? null,
    weight: body.weight ?? 10,
    maxPool: body.maxPool ?? null,
    currentPool: body.currentPool ?? 0,
    isActive: body.isActive ?? true,
  });

  return c.json({ prize }, 201);
});

/** PATCH /admin/referrals/prizes/:id — Update a spinner prize */
adminReferralRoutes.patch("/prizes/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ error: { code: "bad_request", message: "Invalid body" } }, 400);
  }

  const prize = await updateSpinnerPrize(db, id, body);
  return c.json({ prize });
});

/** DELETE /admin/referrals/prizes/:id — Delete a spinner prize */
adminReferralRoutes.delete("/prizes/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  await deleteSpinnerPrize(db, id);
  return c.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────
// Wallet Management
// ──────────────────────────────────────────────────────────────────────

/** POST /admin/referrals/wallet/credit — Manually credit a user's wallet */
adminReferralRoutes.post("/wallet/credit", async (c) => {
  requireCashAdmin(c);
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  const input = walletSchema.safeParse(body);
  if (!input.success) {
    return c.json({ error: { code: "bad_request", message: input.error.message } }, 400);
  }
  if (!body?.profileId || !body?.description) {
    return c.json({ error: { code: "bad_request", message: "profileId, amountHalala, and description required" } }, 400);
  }

  const result = await creditWallet(
    db,
    body.profileId,
    input.data.amountHalala,
    body.description,
    "admin_adjustment",
  );

  return c.json(result);
});

/** POST /admin/referrals/wallet/debit — Manually debit a user's wallet */
adminReferralRoutes.post("/wallet/debit", async (c) => {
  requireCashAdmin(c);
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  const input = walletSchema.safeParse(body);
  if (!input.success) {
    return c.json({ error: { code: "bad_request", message: input.error.message } }, 400);
  }
  if (!body?.profileId || !body?.description) {
    return c.json({ error: { code: "bad_request", message: "profileId, amountHalala, and description required" } }, 400);
  }

  try {
    const result = await debitWallet(
      db,
      body.profileId,
      input.data.amountHalala,
      body.description,
      "admin_adjustment",
    );
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Debit failed";
    return c.json({ error: { code: "debit_failed", message } }, 400);
  }
});

/** GET /admin/referrals/wallet/:profileId — Get a user's wallet transactions */
adminReferralRoutes.get("/wallet/:profileId", async (c) => {
  const db = getDb(c.env);
  const profileId = c.req.param("profileId");

  const wallet = await getWalletByProfileId(db, profileId);
  if (!wallet) {
    return c.json({ error: { code: "not_found", message: "Wallet not found" } }, 404);
  }

  const transactions = await getWalletTransactions(db, profileId, { limit: 100 });

  return c.json({ wallet, transactions });
});

// ──────────────────────────────────────────────────────────────────────
// Adaptive Engine
// ──────────────────────────────────────────────────────────────────────

/** GET /admin/referrals/metrics — Get daily metrics */
adminReferralRoutes.get("/metrics", async (c) => {
  const db = getDb(c.env);
  const startDate = c.req.query("startDate") ?? undefined;
  const endDate = c.req.query("endDate") ?? undefined;
  const limit = Number(c.req.query("limit") ?? "30");

  const { getDailyMetrics } = await import("../db/adaptive.js");
  const metrics = await getDailyMetrics(db, { startDate, endDate, limit });

  return c.json({ metrics });
});

/** GET /admin/referrals/metrics/latest — Get latest metrics + rolling averages */
adminReferralRoutes.get("/metrics/latest", async (c) => {
  const db = getDb(c.env);
  const { getLatestMetrics, getRollingAverages } = await import("../db/adaptive.js");

  const latest = await getLatestMetrics(db);
  const rolling = await getRollingAverages(db);

  return c.json({ latest, rolling });
});

/** POST /admin/referrals/metrics/aggregate — Run nightly aggregation (manual trigger) */
adminReferralRoutes.post("/metrics/aggregate", async (c) => {
  const db = getDb(c.env);
  const { runNightlyAggregation } = await import("../db/adaptive.js");

  const result = await runNightlyAggregation(db);
  return c.json(result);
});

/** POST /admin/referrals/adjust — Run weekly adjustment (manual trigger) */
adminReferralRoutes.post("/adjust", async (c) => {
  const db = getDb(c.env);
  const { runWeeklyAdjustment } = await import("../db/adaptive.js");

  const result = await runWeeklyAdjustment(db);
  return c.json(result);
});

/** GET /admin/referrals/adjust/log — Get adjustment log */
adminReferralRoutes.get("/adjust/log", async (c) => {
  const db = getDb(c.env);
  const limit = Number(c.req.query("limit") ?? "50");
  const flaggedOnly = c.req.query("flagged") === "true";

  const { getAdjustmentLog } = await import("../db/adaptive.js");
  const log = await getAdjustmentLog(db, { limit, flaggedOnly });

  return c.json({ log });
});

/** POST /admin/referrals/adjust/manual — Manual adjustment */
adminReferralRoutes.post("/adjust/manual", async (c) => {
  requireCashAdmin(c);
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  if (!body?.reason) {
    return c.json({ error: { code: "bad_request", message: "reason required" } }, 400);
  }

  const { manualAdjustment } = await import("../db/adaptive.js");
  await manualAdjustment(db, {
    commissionPct: body.commissionPct,
    weeklySpinCap: body.weeklySpinCap,
    topPrizeCostHalala: body.topPrizeCostHalala,
    rewardBudgetPct: body.rewardBudgetPct,
    reason: body.reason,
  });

  return c.json({ ok: true });
});

/** PATCH /admin/referrals/adaptive — Toggle adaptive engine */
adminReferralRoutes.patch("/adaptive", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  if (body?.enabled === undefined) {
    return c.json({ error: { code: "bad_request", message: "enabled required" } }, 400);
  }

  const { setAdaptiveEnabled } = await import("../db/adaptive.js");
  await setAdaptiveEnabled(db, body.enabled);

  return c.json({ ok: true, enabled: body.enabled });
});

/** PATCH /admin/referrals/guardrails — Update guardrails */
adminReferralRoutes.patch("/guardrails", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ error: { code: "bad_request", message: "Invalid body" } }, 400);
  }

  const { updateGuardrails } = await import("../db/adaptive.js");
  await updateGuardrails(db, body);

  return c.json({ ok: true });
});
