import { Hono } from "hono";
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
import { getActiveSpinnerPrizes, createSpinnerPrize, updateSpinnerPrize } from "../db/spinner.js";

export const adminReferralRoutes = new Hono<{ Bindings: AppEnv }>();

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

  if (!body) {
    return c.json({ error: { code: "bad_request", message: "Invalid body" } }, 400);
  }

  const settings = await updateReferralSettings(db, body);
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
// Spinner Prizes
// ──────────────────────────────────────────────────────────────────────

/** GET /admin/referrals/prizes — Get all spinner prizes */
adminReferralRoutes.get("/prizes", async (c) => {
  const db = getDb(c.env);
  const prizes = await getActiveSpinnerPrizes(db);
  return c.json({ prizes });
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

// ──────────────────────────────────────────────────────────────────────
// Wallet Management
// ──────────────────────────────────────────────────────────────────────

/** POST /admin/referrals/wallet/credit — Manually credit a user's wallet */
adminReferralRoutes.post("/wallet/credit", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  if (!body?.profileId || !body?.amountHalala || !body?.description) {
    return c.json({ error: { code: "bad_request", message: "profileId, amountHalala, and description required" } }, 400);
  }

  const result = await creditWallet(
    db,
    body.profileId,
    body.amountHalala,
    body.description,
    "admin_adjustment",
  );

  return c.json(result);
});

/** POST /admin/referrals/wallet/debit — Manually debit a user's wallet */
adminReferralRoutes.post("/wallet/debit", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => null);

  if (!body?.profileId || !body?.amountHalala || !body?.description) {
    return c.json({ error: { code: "bad_request", message: "profileId, amountHalala, and description required" } }, 400);
  }

  try {
    const result = await debitWallet(
      db,
      body.profileId,
      body.amountHalala,
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
