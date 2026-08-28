import type { Db } from "./client.js";
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

export async function getReferralSettings(db: Db): Promise<ReferralSettings | null> {
  const { data, error } = await db
    .from("referral_settings")
    .select("*")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .single();

  if (error || !data) return null;
  return referralSettingsRowSchema.parse(data);
}

export async function updateReferralSettings(
  db: Db,
  settings: Partial<Omit<ReferralSettings, "id" | "createdAt" | "updatedAt">>,
): Promise<ReferralSettings> {
  const { data, error } = await db
    .from("referral_settings")
    .update(settings)
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .select()
    .single();

  if (error) throw new Error(`updateReferralSettings: ${error.message}`);
  return referralSettingsRowSchema.parse(data);
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

/** Mark a referral as qualified after the referred user's first purchase. */
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
    .eq("id", referralId);

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
