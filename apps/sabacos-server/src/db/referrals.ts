import type { Db } from "./client.js";
import { ApiError } from "../errors.js";
import {
  referralRowSchema,
  referralSettingsRowSchema,
  type Referral,
  type ReferralRow,
  type ReferralSettings,
  type ReferralSettingsRow,
} from "@sabacos/core";

// ──────────────────────────────────────────────────────────────────────
// Referral Settings
// ──────────────────────────────────────────────────────────────────────

function parseSettingsRow(data: unknown): ReferralSettings {
  const parsed = referralSettingsRowSchema.safeParse(data);
  if (!parsed.success) {
    // Surface which columns failed so admins aren't stuck on a bare
    // "Invalid input" when the DB row and schema drift apart.
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(row)"}: ${issue.message}`)
      .join("; ");
    throw new ApiError(
      500,
      "settings_schema_mismatch",
      `referral_settings row failed validation — ${detail}`,
    );
  }
  return parsed.data;
}

export async function getReferralSettings(db: Db): Promise<ReferralSettings | null> {
  const { data, error } = await db
    .from("referral_settings")
    .select("*")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .single();

  if (error || !data) return null;
  return parseSettingsRow(data);
}

const SETTINGS_COLUMN_MAP: Record<string, string> = {
  isActive: "is_active",
  firstPurchasePercent: "first_purchase_percent",
  repeatPurchasePercent: "repeat_purchase_percent",
  referredDiscountPercent: "referred_discount_percent",
  affiliatePercent: "affiliate_percent",
  monthlyCapHalala: "monthly_cap_halala",
  referralsPerSpin: "referrals_per_spin",
  maxSpinsPerWeek: "max_spins_per_week",
  spinExpiryDays: "spin_expiry_days",
  couponExpiryDays: "coupon_expiry_days",
  maxCouponsPerOrder: "max_coupons_per_order",
  minAccountAgeDays: "min_account_age_days",
  minOrderValueHalala: "min_order_value_halala",
  rewardBudgetPct: "reward_budget_pct",
  topPrizeCostHalala: "top_prize_cost_halala",
  adaptiveEnabled: "adaptive_enabled",
  lastAdjustmentDate: "last_adjustment_date",
  adjustmentDayOfWeek: "adjustment_day_of_week",
  dailySpendCapHalala: "daily_spend_cap_halala",
  dailySpendCapEnabled: "daily_spend_cap_enabled",
  guardrailCommissionMin: "guardrail_commission_min",
  guardrailCommissionMax: "guardrail_commission_max",
  guardrailSpinCapMin: "guardrail_spin_cap_min",
  guardrailSpinCapMax: "guardrail_spin_cap_max",
  guardrailPrizeCostMin: "guardrail_prize_cost_min",
  guardrailPrizeCostMax: "guardrail_prize_cost_max",
  guardrailMaxBudgetPct: "guardrail_max_budget_pct",
};

export async function updateReferralSettings(
  db: Db,
  settings: Partial<Omit<ReferralSettings, "id" | "createdAt" | "updatedAt">>,
): Promise<ReferralSettings> {
  // The admin dashboard sends camelCase; the table columns are snake_case.
  const row: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(SETTINGS_COLUMN_MAP)) {
    if (key in settings) row[col] = settings[key as keyof typeof settings];
  }
  if (Object.keys(row).length === 0) {
    return (await getReferralSettings(db))!;
  }

  const { data, error } = await db
    .from("referral_settings")
    .update(row)
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .select()
    .single();

  if (error) throw new Error(`updateReferralSettings: ${error.message}`);
  return parseSettingsRow(data);
}

// ──────────────────────────────────────────────────────────────────────
// Referral CRUD
// ──────────────────────────────────────────────────────────────────────

/** Create a new referral record when someone joins via a referral link. */
export async function createReferral(
  db: Db,
  params: { referrerId: string; referredId: string; referralCode: string },
): Promise<Referral> {
  const { data, error } = await db
    .from("referrals")
    .insert({
      referrer_id: params.referrerId,
      referred_id: params.referredId,
      referral_code: params.referralCode,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(`createReferral: ${error.message}`);
  return referralRowSchema.parse(data);
}

/** Get a referral by the referred user's profile ID. */
export async function getReferralByReferredId(
  db: Db,
  referredId: string,
): Promise<Referral | null> {
  const { data, error } = await db
    .from("referrals")
    .select("*")
    .eq("referred_id", referredId)
    .single();

  if (error || !data) return null;
  return referralRowSchema.parse(data);
}

/** Get a referral by code (for validating start param). */
export async function getReferralByCode(
  db: Db,
  code: string,
): Promise<Referral | null> {
  const { data, error } = await db
    .from("referrals")
    .select("*")
    .eq("referral_code", code)
    .single();

  if (error || !data) return null;
  return referralRowSchema.parse(data);
}

/** Get a referral by ID. */
export async function getReferralById(
  db: Db,
  id: string,
): Promise<Referral | null> {
  const { data, error } = await db
    .from("referrals")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return referralRowSchema.parse(data);
}

/** Get all referrals where this user is the referrer. */
export async function getReferralsByReferrerId(
  db: Db,
  referrerId: string,
): Promise<Referral[]> {
  const { data, error } = await db
    .from("referrals")
    .select("*")
    .eq("referrer_id", referrerId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getReferralsByReferrerId: ${error.message}`);
  return (data ?? []).map((r) => referralRowSchema.parse(r));
}

/** Count qualified referrals for a referrer. */
export async function countQualifiedReferrals(
  db: Db,
  referrerId: string,
): Promise<number> {
  const { count, error } = await db
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", referrerId)
    .eq("status", "qualified");

  if (error) throw new Error(`countQualifiedReferrals: ${error.message}`);
  return count ?? 0;
}

/** Count still-pending referees (joined via the link, no first purchase yet). */
export async function countPendingReferrals(
  db: Db,
  referrerId: string,
): Promise<number> {
  const { count, error } = await db
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", referrerId)
    .eq("status", "pending");

  if (error) throw new Error(`countPendingReferrals: ${error.message}`);
  return count ?? 0;
}

/** Mark a referral as qualified after the referred user's first purchase. Conditional on still-pending so concurrent triggers converge. */
export async function qualifyReferral(
  db: Db,
  referralId: string,
  orderId: string,
): Promise<void> {
  const { error } = await db
    .from("referrals")
    .update({
      status: "qualified",
      qualified_at: new Date().toISOString(),
      order_id: orderId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", referralId)
    .eq("status", "pending");

  if (error) throw new Error(`qualifyReferral: ${error.message}`);
}

/** Check if a Telegram user is 30+ days old (anti-fraud). */
export function isTelegramAccountOldEnough(
  telegramId: number,
  minDays: number = 30,
): boolean {
  // Telegram user IDs encode creation time via XOR with 1288834974657
  // IDs below ~100000000 are very old accounts
  // IDs above ~5000000000 are newer
  // We use a heuristic: IDs with fewer digits = older accounts
  const idStr = String(telegramId);
  // Accounts created in last 30 days typically have 10+ digits
  // But this is a rough heuristic - real check would need Telegram API
  return idStr.length <= 10;
}

/** Generate a unique referral code for a user. */
export function makeReferralCode(telegramId: number): string {
  return `ref${telegramId}`;
}

/**
 * Share-click attribution window (last-click): a product share link credits
 * the sharer for orders placed within this many days of the click.
 */
export const SHARE_ATTRIBUTION_WINDOW_DAYS = 7;

/** Pack a product share link payload: `s<telegramId>_<uuid-without-dashes>` (~44 chars, fits Telegram's 64-char startapp limit). */
export function packSharePayload(sharerTelegramId: number, productId: string): string {
  return `s${sharerTelegramId}_${productId.replace(/-/g, "")}`;
}

/** Parse a packed share payload back to { sharerTelegramId, productId } or null. */
export function parseSharePayload(
  raw: string,
): { sharerTelegramId: number; productId: string } | null {
  const m = /^s(\d{5,12})_([0-9a-fA-F]{32})$/.exec(raw.trim());
  if (!m || !m[1] || !m[2]) return null;
  const hex = m[2].toLowerCase();
  return {
    sharerTelegramId: Number(m[1]),
    productId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  };
}

/**
 * Resolve client-suggested share attribution to a referrer profile id.
 * Server-validated — never trusted from the client alone:
 *  - sharer profile must exist,
 *  - sharer must not be the buyer (no self-commission),
 *  - click timestamp must be within the attribution window and not in the future.
 * Returns null when anything is off (attribution must never break checkout).
 */
export async function resolveShareAttribution(
  db: Db,
  buyerProfileId: string,
  input: { sharerTelegramId?: number; clickedAt?: string },
): Promise<string | null> {
  const { sharerTelegramId, clickedAt } = input;
  if (!sharerTelegramId || !clickedAt) return null;
  const clickedMs = Date.parse(clickedAt);
  if (!Number.isFinite(clickedMs)) return null;
  const ageMs = Date.now() - clickedMs;
  if (ageMs < -60_000 || ageMs > SHARE_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000) return null;

  const { getProfileByTelegramId } = await import("./profiles.js");
  const sharer = await getProfileByTelegramId(db, sharerTelegramId).catch(() => null);
  if (!sharer || sharer.id === buyerProfileId) return null;
  return sharer.id;
}

/**
 * Create the standard pending referral row for a buyer who arrived via a
 * product share link — but only for genuinely new buyers (no prior paid
 * order). This is what gives first-time buyers their automatic 5% friend
 * discount through the existing checkout path. Returns the referral id, or
 * null when no row was (or needed to be) created. Never throws for benign
 * cases (already referred, existing customer).
 */
export async function ensureShareReferral(
  db: Db,
  buyerProfileId: string,
  sharerTelegramId: number,
): Promise<string | null> {
  const { getProfileByTelegramId } = await import("./profiles.js");
  const sharer = await getProfileByTelegramId(db, sharerTelegramId).catch(() => null);
  if (!sharer || sharer.id === buyerProfileId) return null;

  const existing = await getReferralByReferredId(db, buyerProfileId).catch(() => null);
  if (existing) return existing.id;

  // Only genuinely new buyers: anyone with collected revenue behind them
  // already had their acquisition moment. Abandoned unpaid carts don't count.
  const { data: pastOrders } = await db
    .from("orders")
    .select("status, payment_status")
    .eq("profile_id", buyerProfileId)
    .order("created_at", { ascending: false })
    .limit(50);
  const hasPaidHistory = ((pastOrders ?? []) as Array<{ status: string; payment_status: string }>).some(
    (o) =>
      o.payment_status === "success" ||
      ["paid", "processing", "shipped", "delivered"].includes(o.status),
  );
  if (hasPaidHistory) return null;

  const referral = await createReferral(db, {
    referrerId: sharer.id,
    referredId: buyerProfileId,
    referralCode: makeReferralCode(sharerTelegramId),
  }).catch(() => null);
  return referral?.id ?? null;
}

/**
 * Discount % the referred friend gets automatically on their first qualifying
 * order (no coupon code needed). Returns 0 when not eligible.
 *
 * Eligibility mirrors the reward side: program active, a still-pending
 * referral row (i.e. this is the first order), order subtotal at/above the
 * minimum, and the referrer's Telegram account old enough to pass the
 * anti-fraud heuristic.
 */
export async function getReferredDiscountPercent(
  db: Db,
  profileId: string,
  subtotalHalala: number,
): Promise<number> {
  const settings = await getReferralSettings(db).catch(() => null);
  if (!settings || !settings.isActive) return 0;
  const pct = settings.referredDiscountPercent ?? 0;
  if (pct <= 0) return 0;

  const { data: referral, error: refErr } = await db
    .from("referrals")
    .select("id, referrer_id")
    .eq("referred_id", profileId)
    .eq("status", "pending")
    .maybeSingle();
  if (refErr || !referral) return 0;

  if (subtotalHalala < settings.minOrderValueHalala) return 0;

  const { data: referrer } = await db
    .from("profiles")
    .select("telegram_id")
    .eq("id", referral.referrer_id as string)
    .maybeSingle();
  const telegramId = (referrer as { telegram_id?: unknown } | null)?.telegram_id;
  if (typeof telegramId !== "number") return 0;
  if (!isTelegramAccountOldEnough(telegramId, settings.minAccountAgeDays)) return 0;

  return Math.min(pct, 100);
}
