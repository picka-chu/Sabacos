import type { Db } from "./client.js";
import { getReferralById, getReferralSettings, qualifyReferral } from "./referrals.js";
import { createSpinnerCoupon, generateCouponCode, useSpin } from "./spinner.js";

/**
 * Commissionable portion of an order: sum of order-item subtotals whose
 * product is commission-eligible. Evaluated at credit time from the current
 * product flag (toggled in the admin product form).
 */
export async function getCommissionableTotalHalala(db: Db, orderId: string): Promise<number> {
  const { data: items, error: itemsErr } = await db
    .from("order_items")
    .select("product_id, subtotal_halala")
    .eq("order_id", orderId);
  if (itemsErr) throw new Error(`getCommissionableTotalHalala: ${itemsErr.message}`);
  const rows = (items ?? []) as Array<{ product_id: string; subtotal_halala: number }>;
  if (rows.length === 0) return 0;

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const { data: products, error: prodErr } = await db
    .from("products")
    .select("id, commission_eligible")
    .in("id", productIds);
  if (prodErr) throw new Error(`getCommissionableTotalHalala: ${prodErr.message}`);
  const ineligible = new Set(
    ((products ?? []) as Array<{ id: string; commission_eligible: boolean | null }>)
      .filter((p) => p.commission_eligible === false)
      .map((p) => p.id),
  );
  return rows.reduce(
    (sum, r) => sum + (ineligible.has(r.product_id) ? 0 : (r.subtotal_halala ?? 0)),
    0,
  );
}

/**
 * Process referral reward after a successful purchase.
 * This is called from the order finalization flow.
 *
 * Steps:
 * 1. Find pending referral where this user is the referred
 * 2. Validate referral eligibility (min order, account age, etc.)
 * 3. Mark referral as qualified
 * 4. Credit commission to referrer's wallet
 * 5. Grant spin(s) if referral threshold met
 */
export async function processReferralReward(
  db: Db,
  params: {
    referredProfileId: string;
    orderId: string;
    orderTotalHalala: number;
  },
): Promise<{
  success: boolean;
  commissionHalala?: number;
  flaggedForReview?: boolean;
  spinsEarned?: number;
  error?: string;
}> {
  const { referredProfileId, orderId, orderTotalHalala } = params;

  // Get settings
  const settings = await getReferralSettings(db);
  if (!settings || !settings.isActive) {
    return { success: false, error: "referral_program_inactive" };
  }

  // Check daily spend cap
  if (settings.dailySpendCapEnabled) {
    const { data: capResult } = await db.rpc("check_daily_spend_cap");
    if (capResult?.exceeded) {
      return { success: false, error: "daily_spend_cap_exceeded" };
    }
  }

  // Check minimum order value
  if (orderTotalHalala < settings.minOrderValueHalala) {
    return { success: false, error: "order_below_minimum" };
  }

  // Find the pending referral for this user
  const { data: referralRow, error: refErr } = await db
    .from("referrals")
    .select("*")
    .eq("referred_id", referredProfileId)
    .eq("status", "pending")
    .single();

  if (refErr || !referralRow) {
    return { success: false, error: "no_pending_referral" };
  }

  const referral = await getReferralById(db, referralRow.id);
  if (!referral || referral.status !== "pending") {
    return { success: false, error: "referral_already_qualified" };
  }

  // Mark referral as qualified
  await qualifyReferral(db, referral.id, orderId);

  // Commission base = eligible items only. Products with commission_eligible
  // = false (thin-margin SKUs, opt-out in the admin product form) earn no
  // commission. The friend discount and referral qualification are order-level
  // and unaffected — only the sharer's cut is filtered.
  const commissionBaseHalala = await getCommissionableTotalHalala(db, orderId);

  // Calculate the raw commission (first purchase only), then credit it
  // atomically per-referrer via credit_referral_commission(). The function
  // serializes concurrent credits for one referrer (advisory lock), enforces
  // the rolling 30-day cap, and soft-flags at 60% of cap — the old code read
  // a platform-wide total with no referrer filter and no locking, so the cap
  // was shared across referrers and racable.
  const rawCommissionHalala = Math.floor(
    (commissionBaseHalala * settings.firstPurchasePercent) / 100,
  );

  const { data: creditResult, error: creditError } = await db.rpc(
    "credit_referral_commission",
    {
      p_referral_id: referral.id,
      p_order_id: orderId,
      p_raw_commission_halala: rawCommissionHalala,
    },
  );
  if (creditError) {
    throw new Error(`credit_referral_commission: ${creditError.message}`);
  }
  const credit = (creditResult ?? {}) as {
    status?: string;
    credited_halala?: number;
    flagged?: boolean;
  };
  const actualCommission = Number(credit.credited_halala ?? 0);
  const flaggedForReview = credit.flagged === true;

  // Count qualified referrals and grant spins if threshold met
  const { count: qualifiedCount } = await db
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", referral.referrerId)
    .eq("status", "qualified");

  const totalQualified = (qualifiedCount ?? 0) + 1; // +1 for this referral
  const spinsEarned = Math.floor(totalQualified / settings.referralsPerSpin);

  // Count existing available spins
  const { count: existingSpins } = await db
    .from("spinner_spins")
    .select("*", { count: "exact", head: true })
    .eq("profile_id", referral.referrerId)
    .eq("status", "available");

  const newSpinsToGrant = Math.max(0, spinsEarned - (existingSpins ?? 0));

  // Grant new spins
  for (let i = 0; i < newSpinsToGrant; i++) {
    await db.from("spinner_spins").insert({
      profile_id: referral.referrerId,
      expires_at: new Date(
        Date.now() + settings.spinExpiryDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

    await db.from("referral_rewards").insert({
      referral_id: referral.id,
      reward_type: "spin_granted",
      metadata: { referrer_id: referral.referrerId },
    });
  }

  return {
    success: true,
    commissionHalala: actualCommission,
    flaggedForReview,
    spinsEarned: newSpinsToGrant,
  };
}

// Velocity-fraud thresholds for Track 2 (tunable; promote to settings if
// they ever need per-deploy tuning without a code change).
/** Attributed commissions in 24h at/above this → velocity_spike flag. */
export const ATTRIBUTED_24H_FLAG_COUNT = 10;
/** Distinct attributed buyers in 7d at/above this → buyer_cluster flag. */
export const ATTRIBUTED_BUYER_CLUSTER_FLAG_COUNT = 8;
/** Buyer account younger than this at order time → instant_farm flag. */
export const ATTRIBUTED_INSTANT_FARM_MINUTES = 30;

/**
 * Track 2: commission on an attributed repeat order (product share link).
 *
 * No-double-pay rule with Track 1: when the buyer's referral row is still
 * pending (Track 1 will consume this order) or was already qualified BY this
 * order (Track 1 just consumed it), this returns early — the first
 * attributed order always belongs to Track 1 alone. No spins here (spins
 * reward acquisition, i.e. Track 1 only) and no buyer discount beyond the
 * first order.
 *
 * Fraud: self-attribution is blocked at checkout (attributed_to is
 * server-validated); velocity signals below only ever soft-flag
 * (pending_review, still credited), never hard-block a legitimate whale.
 */
export async function processAttributedCommission(
  db: Db,
  params: {
    orderId: string;
    sharerProfileId: string;
    buyerProfileId: string;
    orderTotalHalala: number;
  },
): Promise<{
  success: boolean;
  commissionHalala?: number;
  flaggedForReview?: boolean;
  error?: string;
}> {
  const { orderId, sharerProfileId, buyerProfileId, orderTotalHalala } = params;
  if (!sharerProfileId || sharerProfileId === buyerProfileId) {
    return { success: false, error: "no_attribution" };
  }

  const settings = await getReferralSettings(db);
  if (!settings || !settings.isActive) {
    return { success: false, error: "referral_program_inactive" };
  }

  if (settings.dailySpendCapEnabled) {
    const { data: capResult } = await db.rpc("check_daily_spend_cap");
    if (capResult?.exceeded) {
      return { success: false, error: "daily_spend_cap_exceeded" };
    }
  }

  if (orderTotalHalala < settings.minOrderValueHalala) {
    return { success: false, error: "order_below_minimum" };
  }

  // No-double-pay: Track 1 owns the first attributed order.
  const { getReferralByReferredId } = await import("./referrals.js");
  const buyerReferral = await getReferralByReferredId(db, buyerProfileId).catch(() => null);
  if (
    buyerReferral &&
    (buyerReferral.status === "pending" || buyerReferral.orderId === orderId)
  ) {
    return { success: false, error: "track1_owns_order" };
  }

  // Cancelled orders earn nothing (reversal covers post-credit refunds).
  const { data: orderRow } = await db
    .from("orders")
    .select("id, status, created_at")
    .eq("id", orderId)
    .maybeSingle();
  const order = orderRow as { id: string; status: string; created_at: string } | null;
  if (!order) return { success: false, error: "order_not_found" };
  if (order.status === "cancelled") return { success: false, error: "order_cancelled" };

  // Commission base = eligible items only (same toggle as Track 1).
  const commissionBaseHalala = await getCommissionableTotalHalala(db, orderId);
  const affiliatePercent = settings.affiliatePercent ?? 10;
  const rawCommissionHalala = Math.floor((commissionBaseHalala * affiliatePercent) / 100);
  if (rawCommissionHalala <= 0) {
    return { success: true, commissionHalala: 0, flaggedForReview: false };
  }

  // Velocity fraud signals (soft flags only).
  const flags: string[] = [];
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count: attributed24h } = await db
    .from("referral_rewards")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", sharerProfileId)
    .eq("reward_type", "commission")
    .gte("created_at", dayAgo);
  if ((attributed24h ?? 0) >= ATTRIBUTED_24H_FLAG_COUNT) flags.push("velocity_spike");

  const { data: recentAttributed } = await db
    .from("orders")
    .select("profile_id")
    .eq("attributed_to_profile_id", sharerProfileId)
    .gte("created_at", weekAgo)
    .limit(200);
  const distinctBuyers = new Set(
    ((recentAttributed ?? []) as Array<{ profile_id: string }>).map((o) => o.profile_id),
  );
  if (distinctBuyers.size >= ATTRIBUTED_BUYER_CLUSTER_FLAG_COUNT) flags.push("buyer_cluster");

  const { data: buyerProfile } = await db
    .from("profiles")
    .select("created_at")
    .eq("id", buyerProfileId)
    .maybeSingle();
  const buyerCreatedAt = (buyerProfile as { created_at?: string } | null)?.created_at;
  if (buyerCreatedAt) {
    const ageAtOrderMs =
      new Date(order.created_at).getTime() - new Date(buyerCreatedAt).getTime();
    if (ageAtOrderMs >= 0 && ageAtOrderMs < ATTRIBUTED_INSTANT_FARM_MINUTES * 60 * 1000) {
      flags.push("instant_farm");
    }
  }

  const { data: creditResult, error: creditError } = await db.rpc(
    "credit_referral_commission",
    {
      p_referral_id: null,
      p_order_id: orderId,
      p_raw_commission_halala: rawCommissionHalala,
      p_referrer_id: sharerProfileId,
      p_flag_reason: flags.length > 0 ? flags.join(",") : null,
    },
  );
  if (creditError) {
    throw new Error(`credit_referral_commission: ${creditError.message}`);
  }
  const credit = (creditResult ?? {}) as {
    status?: string;
    credited_halala?: number;
    flagged?: boolean;
  };
  return {
    success: true,
    commissionHalala: Number(credit.credited_halala ?? 0),
    flaggedForReview: credit.flagged === true,
  };
}

/**
 * Process a spin for a user.
 * Returns the prize won and creates a coupon if applicable.
 */
export async function processSpin(
  db: Db,
  profileId: string,
  spinId: string,
): Promise<{
  prize: { name: string; type: string; value: number };
  coupon?: { code: string; discountType: string; discountValue: number; expiresAt: string };
  spinAgain?: boolean;
}> {
  const settings = await getReferralSettings(db);

  // Check weekly spin cap
  if (settings) {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: weeklySpins } = await db
      .from("spinner_spins")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("status", "used")
      .gte("won_at", oneWeekAgo);

    if ((weeklySpins ?? 0) >= settings.maxSpinsPerWeek) {
      throw new Error("Weekly spin limit reached");
    }
  }

  // Use the spin
  const { spin, prize } = await useSpin(db, spinId);

  // Handle different prize types
  switch (prize.prizeType) {
    case "spin_again": {
      // Grant a new spin
      await db.from("spinner_spins").insert({
        profile_id: profileId,
        expires_at: settings
          ? new Date(Date.now() + settings.spinExpiryDays * 24 * 60 * 60 * 1000).toISOString()
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      return {
        prize: { name: prize.name, type: "spin_again", value: 0 },
        spinAgain: true,
      };
    }

    case "coupon_percent":
    case "coupon_fixed": {
      const couponExpiryDays = settings?.couponExpiryDays ?? 14;
      const expiresAt = new Date(Date.now() + couponExpiryDays * 24 * 60 * 60 * 1000);

      const coupon = await createSpinnerCoupon(db, {
        profileId,
        spinId: spin.id,
        code: generateCouponCode(),
        discountType: prize.prizeType === "coupon_percent" ? "percent" : "fixed",
        discountValue: prize.value,
        minOrderHalala: settings?.minOrderValueHalala ?? 10000,
        expiresAt,
      });

      return {
        prize: { name: prize.name, type: prize.prizeType, value: prize.value },
        coupon: {
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          expiresAt: coupon.expiresAt,
        },
      };
    }

    case "free_product": {
      // For free product, we'll create a special coupon with 100% discount
      // The product_id is stored on the prize, and the coupon can be applied at checkout
      const couponExpiryDays = settings?.couponExpiryDays ?? 14;
      const expiresAt = new Date(Date.now() + couponExpiryDays * 24 * 60 * 60 * 1000);

      const coupon = await createSpinnerCoupon(db, {
        profileId,
        spinId: spin.id,
        code: generateCouponCode(),
        discountType: "fixed",
        discountValue: 0, // Free product - value is on the prize's product
        minOrderHalala: 0,
        expiresAt,
      });

      return {
        prize: { name: prize.name, type: "free_product", value: 0 },
        coupon: {
          code: coupon.code,
          discountType: "free_product",
          discountValue: 0,
          expiresAt: coupon.expiresAt,
        },
      };
    }

    default:
      return {
        prize: { name: prize.name, type: prize.prizeType, value: prize.value },
      };
  }
}

/**
 * Reverse commission when a referred order is refunded/cancelled.
 * Debits the commission back from the referrer's wallet.
 */
export async function reverseCommissionOnRefund(
  db: Db,
  orderId: string,
  reason: string = "Order refunded",
): Promise<{ reversed: boolean; amountHalala?: number }> {
  // Find the referral for this order
  const { data: referralRow } = await db
    .from("referrals")
    .select("id, referrer_id")
    .eq("referred_id", (await db.from("orders").select("profile_id").eq("id", orderId).single()).data?.profile_id ?? "")
    .eq("status", "qualified")
    .single();

  if (!referralRow) return { reversed: false };

  // Find the commission reward for this order
  const { data: reward } = await db
    .from("referral_rewards")
    .select("id, amount_halala, metadata")
    .eq("referral_id", referralRow.id)
    .eq("reward_type", "commission")
    .contains("metadata", { order_id: orderId })
    .single();

  if (!reward || !reward.amount_halala) return { reversed: false };

  // Check if already reversed
  const { data: existing } = await db
    .from("commission_reversals")
    .select("id")
    .eq("referral_id", referralRow.id)
    .eq("order_id", orderId)
    .single();

  if (existing) return { reversed: false };

  // Debit from referrer's wallet
  const { debitWallet } = await import("./wallet.js");
  await debitWallet(
    db,
    referralRow.referrer_id,
    reward.amount_halala,
    `Commission reversed: ${reason}`,
    "commission_reversal",
    referralRow.id,
  );

  // Log the reversal
  await db.from("commission_reversals").insert({
    referral_id: referralRow.id,
    order_id: orderId,
    amount_halala: reward.amount_halala,
    reason,
  });

  // Cash already sent out cannot be clawed back — flag any payout that
  // included this reward so the admin sees it (audit trail for review).
  await flagPayoutsForReversedReward(db, reward.id as string, orderId, reason).catch((err) =>
    console.error(`Payout flag failed for order ${orderId}:`, err),
  );

  return { reversed: true, amountHalala: reward.amount_halala };
}

// ──────────────────────────────────────────────────────────────────────
// Weekly cash withdrawal via Chapa
// ──────────────────────────────────────────────────────────────────────

/** Withdrawal floor: below this on payout day, the balance carries over. */
export const WITHDRAWAL_THRESHOLD_HALALA = 50_000; // 500 ETB

/** Buffer between credit and cash-out eligibility (mirrors the SQL default). */
export const WITHDRAWAL_AGE_DAYS = 7;

export interface PayoutAccount {
  id: string;
  profileId: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ReferralPayoutStatus = "pending" | "processing" | "sent" | "failed";

export interface ReferralPayout {
  id: string;
  referrerId: string;
  amountHalala: number;
  status: ReferralPayoutStatus;
  chapaReference: string;
  chapaTransferId: string | null;
  payoutAccountId: string | null;
  commissionRewardIds: string[];
  reviewFlag: boolean;
  reviewNote: string | null;
  createdAt: string;
  sentAt: string | null;
  failedReason: string | null;
}

function mapPayoutAccount(row: Record<string, unknown>): PayoutAccount {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    accountName: row.account_name as string,
    accountNumber: row.account_number as string,
    bankCode: row.bank_code as string,
    bankName: row.bank_name as string,
    verified: row.verified as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPayout(row: Record<string, unknown>): ReferralPayout {
  return {
    id: row.id as string,
    referrerId: row.referrer_id as string,
    amountHalala: row.amount_halala as number,
    status: row.status as ReferralPayoutStatus,
    chapaReference: row.chapa_reference as string,
    chapaTransferId: (row.chapa_transfer_id as string) ?? null,
    payoutAccountId: (row.payout_account_id as string) ?? null,
    commissionRewardIds: (row.commission_reward_ids as string[]) ?? [],
    reviewFlag: (row.review_flag as boolean) ?? false,
    reviewNote: (row.review_note as string) ?? null,
    createdAt: row.created_at as string,
    sentAt: (row.sent_at as string) ?? null,
    failedReason: (row.failed_reason as string) ?? null,
  };
}

/**
 * Payout weekday for a referrer = weekday of profiles.created_at (UTC, to
 * match SQL EXTRACT(DOW)). Computed, never stored — spreads payouts evenly
 * across the week instead of one global payout day.
 */
export function payoutWeekday(createdAt: string | Date): number {
  return new Date(createdAt).getUTCDay(); // 0 = Sunday … 6 = Saturday
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function payoutWeekdayName(createdAt: string | Date): string {
  return WEEKDAY_NAMES[payoutWeekday(createdAt)] ?? "?";
}

/** Monday 00:00 UTC of the current week (matches PG date_trunc('week')). */
export function startOfWeekUtc(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

/** Canonical cash-out eligibility (single source of truth lives in SQL). */
export async function getEligibleWithdrawalAmount(db: Db, referrerId: string): Promise<number> {
  const { data, error } = await db.rpc("get_eligible_withdrawal_amount", {
    p_referrer_id: referrerId,
  });
  if (error) throw new Error(`get_eligible_withdrawal_amount: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * The specific commission rows backing a payout. Same filters as the SQL
 * function — keep the two in sync: confirmed, aged 7+ days, not reversed,
 * not already in a sent/processing payout.
 */
export async function getEligibleCommissionRewards(
  db: Db,
  referrerId: string,
): Promise<Array<{ id: string; amountHalala: number; orderId: string | null }>> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("referral_rewards")
    .select("id, amount_halala, available_for_withdrawal_at, metadata, created_at")
    .eq("referrer_id", referrerId)
    .eq("reward_type", "commission")
    .eq("status", "confirmed")
    .lte("available_for_withdrawal_at", now);
  if (error) throw new Error(`getEligibleCommissionRewards: ${error.message}`);

  const candidates = ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: r.id as string,
      amountHalala: (r.amount_halala as number) ?? 0,
      orderId: ((r.metadata as Record<string, unknown> | null)?.order_id as string) ?? null,
    }))
    .filter((r) => r.amountHalala > 0);

  if (candidates.length === 0) return [];

  const orderIds = [...new Set(candidates.map((r) => r.orderId).filter(Boolean))] as string[];

  // Exclude reversed orders.
  let reversedOrderIds = new Set<string>();
  if (orderIds.length > 0) {
    const { data: reversals } = await db
      .from("commission_reversals")
      .select("order_id")
      .in("order_id", orderIds);
    reversedOrderIds = new Set(
      ((reversals ?? []) as Array<{ order_id: string }>).map((r) => r.order_id),
    );
  }

  // Exclude rewards already covered by a sent/processing payout.
  const { data: payouts } = await db
    .from("referral_payouts")
    .select("commission_reward_ids")
    .eq("referrer_id", referrerId)
    .in("status", ["sent", "processing"]);
  const paidRewardIds = new Set<string>();
  for (const p of ((payouts ?? []) as Array<{ commission_reward_ids: string[] }>)) {
    for (const id of p.commission_reward_ids ?? []) paidRewardIds.add(id);
  }

  return candidates.filter(
    (r) => (!r.orderId || !reversedOrderIds.has(r.orderId)) && !paidRewardIds.has(r.id),
  );
}

export async function getPayoutAccount(db: Db, profileId: string): Promise<PayoutAccount | null> {
  const { data, error } = await db
    .from("referrer_payout_accounts")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`getPayoutAccount: ${error.message}`);
  return data ? mapPayoutAccount(data as Record<string, unknown>) : null;
}

/** Create or replace the referrer's payout account (resets verification). */
export async function upsertPayoutAccount(
  db: Db,
  profileId: string,
  input: { accountName: string; accountNumber: string; bankCode: string; bankName: string },
): Promise<PayoutAccount> {
  const { data, error } = await db
    .from("referrer_payout_accounts")
    .upsert(
      {
        profile_id: profileId,
        account_name: input.accountName,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        bank_name: input.bankName,
        verified: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(`upsertPayoutAccount: ${error.message}`);
  return mapPayoutAccount(data as Record<string, unknown>);
}

export async function setPayoutAccountVerified(
  db: Db,
  accountId: string,
  verified: boolean,
): Promise<PayoutAccount> {
  const { data, error } = await db
    .from("referrer_payout_accounts")
    .update({ verified, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) throw new Error(`setPayoutAccountVerified: ${error.message}`);
  return mapPayoutAccount(data as Record<string, unknown>);
}

export async function getPayoutById(db: Db, id: string): Promise<ReferralPayout | null> {
  const { data, error } = await db.from("referral_payouts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getPayoutById: ${error.message}`);
  return data ? mapPayout(data as Record<string, unknown>) : null;
}

export async function listPayouts(
  db: Db,
  filters: { referrerId?: string; status?: ReferralPayoutStatus | null; limit?: number } = {},
): Promise<ReferralPayout[]> {
  let query = db.from("referral_payouts").select("*").order("created_at", { ascending: false });
  if (filters.referrerId) query = query.eq("referrer_id", filters.referrerId);
  if (filters.status) query = query.eq("status", filters.status);
  query = query.limit(Math.min(200, Math.max(1, filters.limit ?? 50)));
  const { data, error } = await query;
  if (error) throw new Error(`listPayouts: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(mapPayout);
}

/**
 * Flag payouts that already covered a now-reversed reward. The cash can't be
 * clawed back — this is the audit trail + admin heads-up for future payouts.
 */
export async function flagPayoutsForReversedReward(
  db: Db,
  rewardId: string,
  orderId: string,
  reason: string,
): Promise<number> {
  const { data, error } = await db
    .from("referral_payouts")
    .select("id, status")
    .contains("commission_reward_ids", [rewardId])
    .in("status", ["sent", "processing"]);
  if (error) throw new Error(`flagPayoutsForReversedReward: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string }>;
  for (const row of rows) {
    await db
      .from("referral_payouts")
      .update({
        review_flag: true,
        review_note: `Commission reversed after payout (order ${orderId}): ${reason}`,
      })
      .eq("id", row.id);
  }
  if (rows.length > 0) {
    // Visible in the admin Payouts tab (review_flag/review_note). Cash sent
    // out cannot be clawed back — the admin reviews the referrer there.
    console.warn(
      `[payouts] commission reversed after payout: reward ${rewardId} (order ${orderId}) covered by ${rows.length} sent payout(s)`,
    );
  }
  return rows.length;
}

export interface PayoutRunResult {
  checked: number;
  paid: number;
  paidHalala: number;
  skippedBelowThreshold: number;
  skippedNoAccount: number;
  failed: number;
}

/**
 * Daily payout pass. For every referrer whose payout weekday is today and who
 * has no payout already created this week: pay the eligible amount via Chapa
 * when it meets the 500 ETB threshold and a verified account exists.
 * Below threshold or no verified account → untouched, carries over.
 */
export async function runWeeklyPayouts(
  db: Db,
  env: { CHAPA_SECRET_KEY?: string; BOT_TOKEN: string; ADMIN_CHANNEL_ID?: string },
  now: Date = new Date(),
): Promise<PayoutRunResult> {
  const result: PayoutRunResult = {
    checked: 0,
    paid: 0,
    paidHalala: 0,
    skippedBelowThreshold: 0,
    skippedNoAccount: 0,
    failed: 0,
  };
  const todayDow = now.getUTCDay();
  const weekStart = startOfWeekUtc(now).toISOString();

  // Referrers with any commission history.
  const { data: rewardRows, error: rewardErr } = await db
    .from("referral_rewards")
    .select("referrer_id")
    .eq("reward_type", "commission")
    .not("referrer_id", "is", null);
  if (rewardErr) throw new Error(`runWeeklyPayouts: ${rewardErr.message}`);
  const referrerIds = [
    ...new Set(((rewardRows ?? []) as Array<{ referrer_id: string }>).map((r) => r.referrer_id)),
  ];
  if (referrerIds.length === 0) return result;

  const { data: profiles, error: profileErr } = await db
    .from("profiles")
    .select("id, created_at, first_name, username")
    .in("id", referrerIds);
  if (profileErr) throw new Error(`runWeeklyPayouts: ${profileErr.message}`);

  const { notifyAdminChannel } = await import("../bot/bot.js");
  const { createChapaTransfer, verifyChapaTransfer } = await import("../services/chapa.js");

  for (const p of (profiles ?? []) as Array<{
    id: string;
    created_at: string;
    first_name?: string | null;
    username?: string | null;
  }>) {
    if (payoutWeekday(p.created_at) !== todayDow) continue;

    // AC6: never two payouts for one referrer in the same week.
    const { data: existing } = await db
      .from("referral_payouts")
      .select("id")
      .eq("referrer_id", p.id)
      .in("status", ["pending", "processing", "sent"])
      .gte("created_at", weekStart)
      .limit(1);
    if ((existing ?? []).length > 0) continue;

    result.checked += 1;
    let eligible = 0;
    try {
      eligible = await getEligibleWithdrawalAmount(db, p.id);
    } catch (err) {
      // Loud, not silent: a missing/broken eligibility function must never
      // look like "nobody is eligible". The referrer is skipped this pass.
      console.error(`[payouts] eligibility check failed for ${p.id}:`, err);
      result.failed += 1;
      continue;
    }
    if (eligible < WITHDRAWAL_THRESHOLD_HALALA) {
      result.skippedBelowThreshold += 1;
      continue;
    }

    let account: PayoutAccount | null = null;
    try {
      account = await getPayoutAccount(db, p.id);
    } catch (err) {
      console.error(`[payouts] payout-account lookup failed for ${p.id}:`, err);
      result.failed += 1;
      continue;
    }
    const who = p.first_name ?? p.username ?? p.id;
    if (!account || !account.verified) {
      result.skippedNoAccount += 1;
      await notifyAdminChannel(
        env as never,
        `💸 <b>Payout needs a bank account</b>\n\nReferrer ${who} has ${(eligible / 100).toFixed(2)} ETB eligible for withdrawal but no verified payout account on file. Ask them to add one in the app (Referrals → Wallet).`,
      ).catch(() => undefined);
      continue;
    }

    let rewards: Array<{ id: string; amountHalala: number; orderId: string | null }> = [];
    try {
      rewards = await getEligibleCommissionRewards(db, p.id);
    } catch (err) {
      console.error(`[payouts] eligible-rewards lookup failed for ${p.id}:`, err);
      result.failed += 1;
      continue;
    }
    const rewardIds = rewards.map((r) => r.id);
    if (rewardIds.length === 0) {
      result.skippedBelowThreshold += 1;
      continue;
    }

    if (!env.CHAPA_SECRET_KEY) {
      result.failed += 1;
      const { randomUUID: uuid } = await import("node:crypto");
      await db.from("referral_payouts").insert({
        referrer_id: p.id,
        amount_halala: eligible,
        status: "failed",
        chapa_reference: uuid(),
        payout_account_id: account.id,
        commission_reward_ids: rewardIds,
        failed_reason: "CHAPA_SECRET_KEY not configured",
      });
      await notifyAdminChannel(
        env as never,
        `💸 <b>Payout failed</b>\n\nReferrer ${who}: CHAPA_SECRET_KEY is not configured on the server.`,
      ).catch(() => undefined);
      continue;
    }

    // Insert first (reference = idempotency key, generated up front so the
    // UNIQUE constraint genuinely guards duplicates — never a placeholder).
    const { randomUUID } = await import("node:crypto");
    const chapaReference = randomUUID();
    const { data: payoutRow, error: insertErr } = await db
      .from("referral_payouts")
      .insert({
        referrer_id: p.id,
        amount_halala: eligible,
        status: "pending",
        chapa_reference: chapaReference,
        payout_account_id: account.id,
        commission_reward_ids: rewardIds,
      })
      .select("*")
      .single();
    if (insertErr || !payoutRow) {
      result.failed += 1;
      continue;
    }
    const payout = mapPayout(payoutRow as Record<string, unknown>);

    // Lock the funds BEFORE calling Chapa (same "lock the resource before you
    // commit to using it" pattern finalize_order_payment uses for stock): the
    // debited amount can't be spent in-app while the transfer is in flight.
    // Any definitive Chapa failure credits it straight back below.
    const { debitWallet, creditWallet } = await import("./wallet.js");
    try {
      await debitWallet(db, p.id, eligible, "Referral cash payout via Chapa", "payout", payout.id);
    } catch (err) {
      const reason = `Wallet debit failed: ${err instanceof Error ? err.message : String(err)}`;
      await db
        .from("referral_payouts")
        .update({ status: "failed", failed_reason: reason })
        .eq("id", payout.id);
      result.failed += 1;
      await notifyAdminChannel(
        env as never,
        `💸 <b>Payout failed</b>\n\nReferrer ${who} (${(eligible / 100).toFixed(2)} ETB): ${reason}. Retry from Admin → Referrals → Payouts.`,
      ).catch(() => undefined);
      continue;
    }

    const refundLockedFunds = async (reason: string) => {
      await creditWallet(
        db,
        p.id,
        eligible,
        "Payout refund: Chapa transfer failed",
        "payout_refund",
        payout.id,
      ).catch((err) => console.error(`[payouts] refund credit failed for ${payout.id}:`, err));
      await db
        .from("referral_payouts")
        .update({ status: "failed", failed_reason: reason })
        .eq("id", payout.id);
      result.failed += 1;
    };

    const transfer = await createChapaTransfer(env.CHAPA_SECRET_KEY, {
      accountName: account.accountName,
      accountNumber: account.accountNumber,
      amountHalala: eligible,
      bankCode: account.bankCode,
      reference: payout.chapaReference,
    });

    if (transfer.ok) {
      await db
        .from("referral_payouts")
        .update({
          status: "processing",
          chapa_transfer_id: transfer.transferId,
        })
        .eq("id", payout.id);
      // A live transfer proves the account details — mark verified.
      if (!account.verified) {
        await setPayoutAccountVerified(db, account.id, true).catch(() => undefined);
      }
      result.paid += 1;
      result.paidHalala += eligible;
    } else if (transfer.referenceUsedBefore) {
      // Response was likely lost on a previous attempt — verify instead.
      // Only refund when verification definitively says the money didn't move.
      const verified = await verifyChapaTransfer(env.CHAPA_SECRET_KEY, payout.chapaReference);
      if (verified.status === "success") {
        await db
          .from("referral_payouts")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", payout.id);
        result.paid += 1;
        result.paidHalala += eligible;
      } else if (verified.status === "failed") {
        await refundLockedFunds(transfer.message);
      } else {
        // pending/unknown: money may still be in flight — keep processing,
        // keep the funds locked; the hourly reconcile decides the outcome.
        await db
          .from("referral_payouts")
          .update({ status: "processing" })
          .eq("id", payout.id);
        result.paid += 1;
        result.paidHalala += eligible;
      }
    } else {
      await refundLockedFunds(transfer.message);
      await notifyAdminChannel(
        env as never,
        `💸 <b>Payout failed</b>\n\nReferrer ${who} (${(eligible / 100).toFixed(2)} ETB): ${transfer.message}. Locked funds were refunded to the wallet. Retry from Admin → Referrals → Payouts.`,
      ).catch(() => undefined);
    }
  }

  return result;
}

/** Hourly reconcile: close the loop on 'processing' payouts via Chapa verify. */
export async function reconcileProcessingPayouts(
  db: Db,
  env: { CHAPA_SECRET_KEY?: string },
): Promise<{ checked: number; sent: number; failed: number }> {
  const out = { checked: 0, sent: 0, failed: 0 };
  if (!env.CHAPA_SECRET_KEY) return out;

  const { data, error } = await db
    .from("referral_payouts")
    .select("id, referrer_id, amount_halala, chapa_reference")
    .eq("status", "processing")
    .limit(100);
  if (error) throw new Error(`reconcileProcessingPayouts: ${error.message}`);

  const { verifyChapaTransfer } = await import("../services/chapa.js");
  const { creditWallet } = await import("./wallet.js");
  for (const row of ((data ?? []) as Array<{ id: string; referrer_id: string; amount_halala: number; chapa_reference: string }>)) {
    out.checked += 1;
    const verified = await verifyChapaTransfer(env.CHAPA_SECRET_KEY, row.chapa_reference).catch(() => ({
      status: "unknown" as const,
      message: "verify call failed",
    }));
    if (verified.status === "success") {
      await db
        .from("referral_payouts")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);
      out.sent += 1;
    } else if (verified.status === "failed") {
      // Definitive failure discovered late — refund the locked funds too.
      await creditWallet(
        db,
        row.referrer_id,
        row.amount_halala,
        "Payout refund: Chapa transfer failed",
        "payout_refund",
        row.id,
      ).catch((err) => console.error(`[payouts] refund credit failed for ${row.id}:`, err));
      await db
        .from("referral_payouts")
        .update({ status: "failed", failed_reason: verified.message })
        .eq("id", row.id);
      out.failed += 1;
    }
    // pending/unknown: leave processing (funds stay locked), retry next hour.
  }
  return out;
}

/** Manual retry of a failed payout — reuses the same Chapa reference (idempotent). */
export async function retryPayout(
  db: Db,
  env: { CHAPA_SECRET_KEY?: string; BOT_TOKEN: string; ADMIN_CHANNEL_ID?: string },
  payoutId: string,
): Promise<ReferralPayout> {
  const payout = await getPayoutById(db, payoutId);
  if (!payout) throw new Error("Payout not found");
  if (payout.status !== "failed") throw new Error("Only failed payouts can be retried");
  if (!env.CHAPA_SECRET_KEY) throw new Error("CHAPA_SECRET_KEY not configured");

  const account = payout.payoutAccountId
    ? await db
        .from("referrer_payout_accounts")
        .select("*")
        .eq("id", payout.payoutAccountId)
        .maybeSingle()
        .then((r) => (r.data ? mapPayoutAccount(r.data as Record<string, unknown>) : null))
    : null;
  if (!account) throw new Error("Payout account no longer exists");

  const { createChapaTransfer, verifyChapaTransfer } = await import("../services/chapa.js");
  const { debitWallet, creditWallet } = await import("./wallet.js");
  await db.from("referral_payouts").update({ status: "pending", failed_reason: null }).eq("id", payout.id);

  // Re-lock the funds: every failed payout holds no locked balance (either it
  // never debited, or the failure path refunded), so a fresh debit is safe.
  try {
    await debitWallet(db, payout.referrerId, payout.amountHalala, "Referral cash payout via Chapa", "payout", payout.id);
  } catch (err) {
    const reason = `Wallet debit failed: ${err instanceof Error ? err.message : String(err)}`;
    await db.from("referral_payouts").update({ status: "failed", failed_reason: reason }).eq("id", payout.id);
    throw new Error(reason);
  }

  const refundLockedFunds = async (reason: string) => {
    await creditWallet(
      db,
      payout.referrerId,
      payout.amountHalala,
      "Payout refund: Chapa transfer failed",
      "payout_refund",
      payout.id,
    ).catch((err) => console.error(`[payouts] refund credit failed for ${payout.id}:`, err));
    await db.from("referral_payouts").update({ status: "failed", failed_reason: reason }).eq("id", payout.id);
  };

  const transfer = await createChapaTransfer(env.CHAPA_SECRET_KEY, {
    accountName: account.accountName,
    accountNumber: account.accountNumber,
    amountHalala: payout.amountHalala,
    bankCode: account.bankCode,
    reference: payout.chapaReference,
  });

  if (transfer.ok) {
    await db
      .from("referral_payouts")
      .update({ status: "processing", chapa_transfer_id: transfer.transferId })
      .eq("id", payout.id);
  } else if (transfer.referenceUsedBefore) {
    const verified = await verifyChapaTransfer(env.CHAPA_SECRET_KEY, payout.chapaReference);
    if (verified.status === "success") {
      await db
        .from("referral_payouts")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", payout.id);
    } else if (verified.status === "failed") {
      await refundLockedFunds(transfer.message);
    } else {
      await db
        .from("referral_payouts")
        .update({ status: "processing" })
        .eq("id", payout.id);
    }
  } else {
    await refundLockedFunds(transfer.message);
  }

  const updated = await getPayoutById(db, payout.id);
  if (!updated) throw new Error("Payout vanished during retry");
  return updated;
}
