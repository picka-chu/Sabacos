import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import {
  getReferralSettings,
  getReferralByCode,
  getReferralByReferredId,
  getReferralsByReferrerId,
  countQualifiedReferrals,
  createReferral,
  makeReferralCode,
} from "../db/referrals.js";
import {
  getWalletByProfileId,
  getOrCreateWallet,
  getWalletTransactions,
  getWalletSummary,
} from "../db/wallet.js";
import {
  getAvailableSpins,
  countAvailableSpins,
  getValidCoupons,
} from "../db/spinner.js";
import { processSpin } from "../db/referral-rewards.js";
import { getProfileById, getProfileByTelegramId } from "../db/profiles.js";
import type { UserContext } from "../auth/telegram.js";
import { referralDeepLink } from "@sabacos/core";

export const referralRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

// ──────────────────────────────────────────────────────────────────────
// Referral info
// ──────────────────────────────────────────────────────────────────────

/** GET /referral — Get current user's referral info */
referralRoutes.get("/", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const db = getDb(c.env);

  const settings = await getReferralSettings(db);
  const referral = await getReferralByReferredId(db, profile.id);
  const qualifiedCount = await countQualifiedReferrals(db, profile.id);
  const availableSpins = await countAvailableSpins(db, profile.id);
  const wallet = await getWalletByProfileId(db, profile.id);
  const validCoupons = await getValidCoupons(db, profile.id);

  const code = profile.telegramId ? makeReferralCode(profile.telegramId) : null;
  const deepLink = profile.telegramId
    ? referralDeepLink("sabacosbot", profile.telegramId)
    : null;

  return c.json({
    code,
    deepLink,
    qualifiedCount,
    availableSpins,
    referralProgress: settings
      ? `${qualifiedCount % settings.referralsPerSpin}/${settings.referralsPerSpin} referrals to your next spin`
      : null,
    walletBalance: wallet?.balanceHalala ?? 0,
    validCoupons: validCoupons.length,
    settings: settings
      ? {
          firstPurchasePercent: settings.firstPurchasePercent,
          referralsPerSpin: settings.referralsPerSpin,
          monthlyCapHalala: settings.monthlyCapHalala,
        }
      : null,
  });
});

/** GET /referral/history — Get user's referral history */
referralRoutes.get("/history", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const db = getDb(c.env);
  const referrals = await getReferralsByReferrerId(db, profile.id);

  return c.json({ referrals });
});

// ──────────────────────────────────────────────────────────────────────
// Wallet
// ──────────────────────────────────────────────────────────────────────

/** GET /referral/wallet — Get wallet info and recent transactions */
referralRoutes.get("/wallet", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const db = getDb(c.env);
  const wallet = await getOrCreateWallet(db, profile.id);
  const summary = await getWalletSummary(db, profile.id);
  const transactions = await getWalletTransactions(db, profile.id, { limit: 20 });

  return c.json({
    balance: wallet.balanceHalala,
    summary,
    transactions,
  });
});

// ──────────────────────────────────────────────────────────────────────
// Spinner
// ──────────────────────────────────────────────────────────────────────

/** GET /referral/spinner — Get available spins and prize info */
referralRoutes.get("/spinner", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const db = getDb(c.env);
  const availableSpins = await getAvailableSpins(db, profile.id);
  const settings = await getReferralSettings(db);

  return c.json({
    availableSpins: availableSpins.length,
    spins: availableSpins,
    maxSpinsPerWeek: settings?.maxSpinsPerWeek ?? 5,
  });
});

/** POST /referral/spinner/spin — Use a spin */
referralRoutes.post("/spinner/spin", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const body = await c.req.json().catch(() => null);
  const spinId = body?.spinId;
  if (!spinId) {
    return c.json({ error: { code: "missing_spin_id", message: "spinId required" } }, 400);
  }

  const db = getDb(c.env);
  try {
    const result = await processSpin(db, profile.id, spinId);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Spin failed";
    return c.json({ error: { code: "spin_failed", message } }, 400);
  }
});

/** GET /referral/spinner/coupons — Get valid coupons */
referralRoutes.get("/spinner/coupons", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const db = getDb(c.env);
  const coupons = await getValidCoupons(db, profile.id);

  return c.json({ coupons });
});

// ──────────────────────────────────────────────────────────────────────
// Referral validation (called during /start with referral code)
// ──────────────────────────────────────────────────────────────────────

/** POST /referral/validate — Validate a referral code and create referral */
referralRoutes.post("/validate", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const body = await c.req.json().catch(() => null);
  const code = body?.code;
  if (!code) {
    return c.json({ error: { code: "missing_code", message: "Referral code required" } }, 400);
  }

  const db = getDb(c.env);

  // Check if user already has a referral
  const existing = await getReferralByReferredId(db, profile.id);
  if (existing) {
    return c.json({ error: { code: "already_referred", message: "You were already referred" } }, 400);
  }

  // Find the referral code
  const referral = await getReferralByCode(db, code);
  if (!referral) {
    return c.json({ error: { code: "invalid_code", message: "Invalid referral code" } }, 400);
  }

  // Can't refer yourself
  if (referral.referrerId === profile.id) {
    return c.json({ error: { code: "self_referral", message: "Cannot refer yourself" } }, 400);
  }

  // Create the referral
  const newReferral = await createReferral(db, {
    referrerId: referral.referrerId,
    referredId: profile.id,
    referralCode: code,
  });

  return c.json({ referral: newReferral });
});
