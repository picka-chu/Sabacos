import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import {
  getReferralSettings,
  getReferralByCode,
  getReferralByReferredId,
  getReferralsByReferrerId,
  countQualifiedReferrals,
  countPendingReferrals,
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
  getActiveSpinnerPrizes,
} from "../db/spinner.js";
import { processSpin } from "../db/referral-rewards.js";
import {
  getPayoutAccount,
  upsertPayoutAccount,
  getEligibleWithdrawalAmount,
  WITHDRAWAL_THRESHOLD_HALALA,
} from "../db/referral-rewards.js";
import { getChapaBanks, PAYOUT_METHODS_FALLBACK } from "../services/chapa.js";
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
  const pendingCount = await countPendingReferrals(db, profile.id);
  const availableSpins = await countAvailableSpins(db, profile.id);
  const wallet = await getWalletByProfileId(db, profile.id);
  const validCoupons = await getValidCoupons(db, profile.id);

  const code = profile.telegramId ? makeReferralCode(profile.telegramId) : null;
  const deepLink = profile.telegramId
    ? referralDeepLink(c.env.BOT_USERNAME || "sabacosbot", profile.telegramId)
    : null;

  return c.json({
    code,
    deepLink,
    qualifiedCount,
    pendingCount,
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
          isActive: settings.isActive,
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

  // Attach the referred friend's display name so pending referees are
  // recognizable (not just a code). One batched lookup, never fatal.
  const ids = [...new Set(referrals.map((r) => r.referredId))];
  let nameById = new Map<string, { firstName?: string; username?: string }>();
  if (ids.length > 0) {
    const { data } = await db
      .from("profiles")
      .select("id, first_name, username")
      .in("id", ids);
    nameById = new Map(
      ((data ?? []) as Array<{ id: string; first_name?: string | null; username?: string | null }>).map(
        (p) => [
          p.id,
          {
            ...(p.first_name ? { firstName: p.first_name } : {}),
            ...(p.username ? { username: p.username } : {}),
          },
        ],
      ),
    );
  }

  return c.json({
    referrals: referrals.map((r) => ({ ...r, referred: nameById.get(r.referredId) ?? null })),
  });
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
    referralsPerSpin: settings?.referralsPerSpin ?? 3,
  });
});

/** GET /referral/spinner/prizes — Get active spinner prizes for the wheel */
referralRoutes.get("/spinner/prizes", async (c) => {
  const db = getDb(c.env);
  const prizes = await getActiveSpinnerPrizes(db);
  return c.json({
    prizes: prizes.map((p) => ({
      id: p.id,
      name: p.name,
      prizeType: p.prizeType,
      value: p.value,
      weight: p.weight,
    })),
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
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return c.json({ error: { code: "missing_code", message: "Referral code required" } }, 400);
  }

  const db = getDb(c.env);

  // Check if user already has a referral
  const existing = await getReferralByReferredId(db, profile.id);
  if (existing) {
    return c.json({ error: { code: "already_referred", message: "You were already referred" } }, 400);
  }

  // Resolve the referrer. Invite codes are `ref<telegramId>` (see
  // makeReferralCode), so a first-time sharer with no referral rows yet
  // still resolves — the old lookup below only worked after they had
  // already referred someone once.
  let referrerId: string | null = null;
  const codeMatch = /^ref(\d{5,12})$/.exec(code);
  if (codeMatch) {
    const sharer = await getProfileByTelegramId(db, Number(codeMatch[1])).catch(() => null);
    if (sharer) referrerId = sharer.id;
  }
  if (!referrerId) {
    const referral = await getReferralByCode(db, code);
    if (referral) referrerId = referral.referrerId;
  }
  if (!referrerId) {
    return c.json({ error: { code: "invalid_code", message: "Invalid referral code" } }, 400);
  }

  // Can't refer yourself
  if (referrerId === profile.id) {
    return c.json({ error: { code: "self_referral", message: "Cannot refer yourself" } }, 400);
  }

  // Create the referral
  const newReferral = await createReferral(db, {
    referrerId,
    referredId: profile.id,
    referralCode: code,
  });

  return c.json({ referral: newReferral });
});

/**
 * POST /referral/attribute — record arrival via a product share link.
 * Creates the standard pending referral row for genuinely new buyers only
 * (which unlocks their automatic first-order friend discount); existing
 * customers just get their click stamped client-side for Track 2.
 */
referralRoutes.post("/attribute", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const body = await c.req.json().catch(() => null);
  const sharerTelegramId = body?.sharerTelegramId;
  if (typeof sharerTelegramId !== "number" || !Number.isInteger(sharerTelegramId) || sharerTelegramId <= 0) {
    return c.json({ error: { code: "bad_request", message: "sharerTelegramId required" } }, 400);
  }

  const db = getDb(c.env);
  const { ensureShareReferral } = await import("../db/referrals.js");
  const referralId = await ensureShareReferral(db, profile.id, sharerTelegramId);
  return c.json({ referralId });
});

// ──────────────────────────────────────────────────────────────────────
// Cash payout account (weekly Chapa withdrawals)
// ──────────────────────────────────────────────────────────────────────

/** GET /referral/banks — bank list for the payout-account form (live from Chapa, static fallback otherwise) */
referralRoutes.get("/banks", async (c) => {
  const secret = c.env.CHAPA_SECRET_KEY;
  if (secret) {
    try {
      const banks = await getChapaBanks(secret);
      return c.json({ banks, live: true });
    } catch {
      // Fall through to the static list below.
    }
  }
  return c.json({ banks: PAYOUT_METHODS_FALLBACK, live: false });
});

/** GET /profile/payout-account — current payout account + withdrawal eligibility */
referralRoutes.get("/profile/payout-account", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const db = getDb(c.env);
  const account = await getPayoutAccount(db, profile.id).catch(() => null);
  const eligibleHalala = await getEligibleWithdrawalAmount(db, profile.id).catch(() => 0);

  return c.json({
    account,
    eligibleHalala,
    thresholdHalala: WITHDRAWAL_THRESHOLD_HALALA,
    // Payout weekday (0 = Sunday … 6 = Saturday, UTC — matches the cron's
    // EXTRACT(DOW) check, so the app shows the same day payouts run on.
    payoutWeekday: new Date(profile.createdAt).getUTCDay(),
  });
});

const payoutAccountSchema = {
  accountName: (v: unknown) => typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 120,
  accountNumber: (v: unknown) => typeof v === "string" && /^[0-9]{6,20}$/.test(v.trim()),
  bankCode: (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 64,
};

/** POST /profile/payout-account — submit/update payout bank account */
referralRoutes.post("/profile/payout-account", async (c) => {
  const profile = c.get("profile");
  if (!profile) return c.json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401);

  const body = await c.req.json().catch(() => null);
  const accountName = typeof body?.accountName === "string" ? body.accountName.trim() : "";
  const accountNumber = typeof body?.accountNumber === "string" ? body.accountNumber.trim() : "";
  const bankCode = typeof body?.bankCode === "string" ? body.bankCode.trim() : "";
  if (
    !payoutAccountSchema.accountName(accountName) ||
    !payoutAccountSchema.accountNumber(accountNumber) ||
    !payoutAccountSchema.bankCode(bankCode)
  ) {
    return c.json({
      error: {
        code: "bad_request",
        message: "accountName (2-120 chars), numeric accountNumber (6-20 digits), and bankCode are required",
      },
    }, 400);
  }

  // Resolve the human-readable bank name and confirm the code is real.
  // Accept codes from the live Chapa list or the static fallback list; the
  // code is re-resolved live at payout time, and full validation happens by
  // attempting a real transfer — never silently.
  let bankName = typeof body?.bankName === "string" ? body.bankName.trim().slice(0, 120) : "";
  const secret = c.env.CHAPA_SECRET_KEY;
  let liveBanks: Array<{ code: string; name: string }> | null = null;
  if (secret) {
    try {
      liveBanks = await getChapaBanks(secret);
    } catch {
      liveBanks = null;
    }
  }
  const knownCodes = new Set([
    ...(liveBanks ?? []).map((b) => b.code),
    ...PAYOUT_METHODS_FALLBACK.map((b) => b.code),
  ]);
  if (!knownCodes.has(bankCode)) {
    return c.json({ error: { code: "bad_request", message: "Unknown bank — pick a bank from the list" } }, 400);
  }
  if (liveBanks) {
    const match = liveBanks.find((b) => b.code === bankCode);
    if (match) bankName = match.name;
  }
  if (!bankName) {
    const fallback = PAYOUT_METHODS_FALLBACK.find((b) => b.code === bankCode);
    bankName = fallback?.name ?? bankCode;
  }

  const db = getDb(c.env);
  const account = await upsertPayoutAccount(db, profile.id, {
    accountName,
    accountNumber,
    bankCode,
    bankName,
  });
  return c.json({ account });
});
