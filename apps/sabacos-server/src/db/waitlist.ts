import type { Db } from "./client.js";

// ---------------------------------------------------------- config

export interface WaitlistConfig {
  id: string;
  isActive: boolean;
  discountPercent: number;
  earlyBirdLimit: number;
  deadline: string | null;
  referralBonusPercent: number;
  maxReferralDiscount: number;
  discountGracePeriodDays: number;
  createdAt: string;
  updatedAt: string;
}

const CONFIG_ROW_MAP = {
  id: "id",
  is_active: "isActive",
  discount_percent: "discountPercent",
  early_bird_limit: "earlyBirdLimit",
  deadline: "deadline",
  referral_bonus_percent: "referralBonusPercent",
  max_referral_discount: "maxReferralDiscount",
  discount_grace_period_days: "discountGracePeriodDays",
  created_at: "createdAt",
  updated_at: "updatedAt",
} as const;

function mapConfigRow(row: Record<string, unknown>): WaitlistConfig {
  return {
    id: row.id as string,
    isActive: row.is_active as boolean,
    discountPercent: row.discount_percent as number,
    earlyBirdLimit: row.early_bird_limit as number,
    deadline: (row.deadline as string) ?? null,
    referralBonusPercent: row.referral_bonus_percent as number,
    maxReferralDiscount: row.max_referral_discount as number,
    discountGracePeriodDays: (row.discount_grace_period_days as number) ?? 30,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getWaitlistConfig(db: Db): Promise<WaitlistConfig> {
  const { data, error } = await db
    .from("waitlist_config")
    .select("*")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .single();
  if (error) throw new Error(`getWaitlistConfig: ${error.message}`);
  return mapConfigRow(data as Record<string, unknown>);
}

export async function updateWaitlistConfig(
  db: Db,
  patch: Partial<{
    isActive: boolean;
    discountPercent: number;
    earlyBirdLimit: number;
    deadline: string | null;
    referralBonusPercent: number;
    maxReferralDiscount: number;
    discountGracePeriodDays: number;
  }>,
): Promise<WaitlistConfig> {
  const row: Record<string, unknown> = {};
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.discountPercent !== undefined) row.discount_percent = patch.discountPercent;
  if (patch.earlyBirdLimit !== undefined) row.early_bird_limit = patch.earlyBirdLimit;
  if (patch.deadline !== undefined) row.deadline = patch.deadline;
  if (patch.referralBonusPercent !== undefined) row.referral_bonus_percent = patch.referralBonusPercent;
  if (patch.maxReferralDiscount !== undefined) row.max_referral_discount = patch.maxReferralDiscount;
  if (patch.discountGracePeriodDays !== undefined) row.discount_grace_period_days = patch.discountGracePeriodDays;

  // The grace-period column is added by migration 0008. If it hasn't been
  // applied yet, retry the update without it so the toggle keeps working.
  const run = (includeGrace: boolean) => {
    const payload = includeGrace ? row : { ...row };
    if (!includeGrace) delete payload.discount_grace_period_days;
    return db
      .from("waitlist_config")
      .update(payload)
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .select("*")
      .single();
  };

  let result = await run(true);
  if (
    result.error &&
    row.discount_grace_period_days !== undefined &&
    /discount_grace_period_days/i.test(result.error.message ?? "")
  ) {
    result = await run(false);
  }
  if (result.error) throw new Error(`updateWaitlistConfig: ${result.error.message}`);
  return mapConfigRow(result.data as Record<string, unknown>);
}

// ---------------------------------------------------------- entries

export interface WaitlistEntry {
  id: string;
  profileId: string;
  referralCode: string;
  referredBy: string | null;
  position: number;
  isEarlyBird: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function mapEntryRow(row: Record<string, unknown>): WaitlistEntry {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    referralCode: row.referral_code as string,
    referredBy: (row.referred_by as string) ?? null,
    position: row.position as number,
    isEarlyBird: row.is_early_bird as boolean,
    status: row.status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function getWaitlistEntryByProfile(
  db: Db,
  profileId: string,
): Promise<WaitlistEntry | null> {
  const { data, error } = await db
    .from("waitlist_entries")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`getWaitlistEntryByProfile: ${error.message}`);
  return data ? mapEntryRow(data as Record<string, unknown>) : null;
}

export async function getWaitlistEntryByCode(
  db: Db,
  code: string,
): Promise<WaitlistEntry | null> {
  const { data, error } = await db
    .from("waitlist_entries")
    .select("*")
    .eq("referral_code", code.toUpperCase())
    .maybeSingle();
  if (error) throw new Error(`getWaitlistEntryByCode: ${error.message}`);
  return data ? mapEntryRow(data as Record<string, unknown>) : null;
}

export async function joinWaitlist(
  db: Db,
  profileId: string,
  referredByCode: string | null,
): Promise<WaitlistEntry> {
  const existing = await getWaitlistEntryByProfile(db, profileId);
  if (existing) throw new Error("Already on the waitlist");

  // Resolve referrer
  let referrerEntryId: string | null = null;
  if (referredByCode) {
    const referrer = await getWaitlistEntryByCode(db, referredByCode);
    if (referrer) referrerEntryId = referrer.id;
  }

  // Get next position atomically
  const { data: posData, error: posErr } = await db.rpc("next_waitlist_position");
  if (posErr) throw new Error(`joinWaitlist position: ${posErr.message}`);
  const position = posData as number;

  const config = await getWaitlistConfig(db);
  const isEarlyBird = position <= config.earlyBirdLimit;

  // Generate unique referral code (retry on collision)
  let referralCode = generateReferralCode();
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: existing } = await db
      .from("waitlist_entries")
      .select("id")
      .eq("referral_code", referralCode)
      .maybeSingle();
    if (!existing) break;
    referralCode = generateReferralCode();
  }

  const { data, error } = await db
    .from("waitlist_entries")
    .insert({
      profile_id: profileId,
      referral_code: referralCode,
      referred_by: referrerEntryId,
      position,
      is_early_bird: isEarlyBird,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw new Error(`joinWaitlist insert: ${error.message}`);

  const entry = mapEntryRow(data as Record<string, unknown>);

  // Create discount for the new user (early bird). Expiry is bound later,
  // when the waitlist ends (launch), to now + grace period days.
  if (isEarlyBird && config.isActive) {
    await db.from("user_discounts").insert({
      profile_id: profileId,
      waitlist_entry_id: entry.id,
      discount_percent: config.discountPercent,
      source: "waitlist_early_bird",
    });
  }

  // Give referral bonus to referrer
  if (referrerEntryId && config.referralBonusPercent > 0 && config.isActive) {
    const { data: referrerRow } = await db
      .from("waitlist_entries")
      .select("profile_id")
      .eq("id", referrerEntryId)
      .single();
    if (referrerRow) {
      // Check existing referral discounts to cap at max
      const { data: existingDiscounts } = await db
        .from("user_discounts")
        .select("discount_percent")
        .eq("profile_id", referrerRow.profile_id)
        .eq("source", "waitlist_referral");

      const currentReferralTotal = (existingDiscounts ?? []).reduce(
        (sum, d) => sum + (d.discount_percent as number),
        0,
      );
      const bonusCanAdd = Math.min(
        config.referralBonusPercent,
        Math.max(0, config.maxReferralDiscount - currentReferralTotal),
      );

      if (bonusCanAdd > 0) {
        await db.from("user_discounts").insert({
          profile_id: referrerRow.profile_id,
          waitlist_entry_id: referrerEntryId,
          discount_percent: bonusCanAdd,
          source: "waitlist_referral",
        });
      }
    }
  }

  return entry;
}

export async function listWaitlistEntries(
  db: Db,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): Promise<{ items: (WaitlistEntry & { firstName: string | null; lastName: string | null; username: string | null })[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db
    .from("waitlist_entries")
    .select("*, profiles!inner(first_name, last_name, username)", { count: "exact" })
    .order("position", { ascending: true })
    .range(from, to);

  const { data, error, count } = await query;
  if (error) throw new Error(`listWaitlistEntries: ${error.message}`);

  const items = (data ?? []).map((row: Record<string, unknown>) => {
    const profiles = row.profiles as Record<string, unknown> | null;
    return {
      ...mapEntryRow(row),
      firstName: (profiles?.first_name as string) ?? null,
      lastName: (profiles?.last_name as string) ?? null,
      username: (profiles?.username as string) ?? null,
    };
  });

  return { items, total: count ?? 0, page, pageSize };
}

export async function getWaitlistStats(db: Db): Promise<{
  totalJoined: number;
  earlyBirdCount: number;
  totalReferrals: number;
  totalDiscounts: number;
}> {
  const [joined, earlyBird, referred, discounts] = await Promise.all([
    db.from("waitlist_entries").select("id", { count: "exact", head: true }),
    db.from("waitlist_entries").select("id", { count: "exact", head: true }).eq("is_early_bird", true),
    db.from("waitlist_entries").select("id", { count: "exact", head: true }).not("referred_by", "is", null),
    db.from("user_discounts").select("id", { count: "exact", head: true }),
  ]);

  return {
    totalJoined: joined.count ?? 0,
    earlyBirdCount: earlyBird.count ?? 0,
    totalReferrals: referred.count ?? 0,
    totalDiscounts: discounts.count ?? 0,
  };
}

// ---------------------------------------------------------- discounts

export interface UserDiscount {
  id: string;
  profileId: string;
  waitlistEntryId: string | null;
  discountPercent: number;
  source: string;
  expiresAt: string | null;
  createdAt: string;
}

export async function getActiveDiscountForProfile(
  db: Db,
  profileId: string,
): Promise<UserDiscount | null> {
  let query = db
    .from("user_discounts")
    .select("*")
    .eq("profile_id", profileId);

  // Filter out expired discounts
  const now = new Date().toISOString();
  query = query.or(`expires_at.is.null,expires_at.gt.${now}`);

  const { data, error } = await query.order("discount_percent", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`getActiveDiscountForProfile: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    profileId: data.profile_id as string,
    waitlistEntryId: (data.waitlist_entry_id as string) ?? null,
    discountPercent: data.discount_percent as number,
    source: data.source as string,
    expiresAt: (data.expires_at as string) ?? null,
    createdAt: data.created_at as string,
  };
}

export async function getTotalDiscountForProfile(
  db: Db,
  profileId: string,
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("user_discounts")
    .select("discount_percent")
    .eq("profile_id", profileId)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  if (error) throw new Error(`getTotalDiscountForProfile: ${error.message}`);
  return (data ?? []).reduce((sum, d) => sum + (d.discount_percent as number), 0);
}

// Bind expiry of all waitlist discounts when the shop launches (waitlist
// turned off): they become valid until now + graceDays. A grace of 0 means
// they never expire (expires_at = null).
export async function setWaitlistDiscountGracePeriod(
  db: Db,
  graceDays: number,
): Promise<void> {
  const expiresAt = graceDays > 0
    ? new Date(Date.now() + graceDays * 86_400_000).toISOString()
    : null;
  const { error } = await db
    .from("user_discounts")
    .update({ expires_at: expiresAt })
    .in("source", ["waitlist_early_bird", "waitlist_referral"]);
  if (error) throw new Error(`setWaitlistDiscountGracePeriod: ${error.message}`);
}
