import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
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

export const adminReferralRoutes = new Hono<{ Bindings: AppEnv }>();

const walletSchema = z.object({ amountHalala: z.number().int().positive().max(10_000_000) });

const referralSettingsSchema = z.object({
  firstPurchasePercent: z.number().min(0).max(100).optional(),
  monthlyCapHalala: z.number().int().nonnegative().optional(),
  rewardBudgetPct: z.number().min(0).max(100).optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  adaptiveEnabled: z.boolean().optional(),
}).passthrough(); // allow other fields through

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

  return c.json({
    commissions: rewards.map((r) => ({
      ...r,
      orderId: (r.metadata as Record<string, unknown> | null)?.order_id ?? null,
      referrer: r.referrerId ? (referrers.get(r.referrerId) ?? null) : null,
    })),
  });
});

/** POST /admin/referrals/commissions/release — release due commissions now (same as the nightly job) */
adminReferralRoutes.post("/commissions/release", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);
  const delayDays = body?.delayDays === undefined ? 4 : Number(body.delayDays);
  if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > 90) {
    return c.json({ error: { code: "bad_request", message: "delayDays must be an integer 0-90" } }, 400);
  }

  const { releaseAvailableCommissions } = await import("../db/referral-rewards.js");
  const result = await releaseAvailableCommissions(db, delayDays);
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
