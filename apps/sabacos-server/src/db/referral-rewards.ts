import type { Db } from "./client.js";
import { getReferralById, getReferralSettings, qualifyReferral } from "./referrals.js";
import { creditWallet } from "./wallet.js";
import { createSpinnerCoupon, generateCouponCode, useSpin } from "./spinner.js";

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

  // Calculate commission (first purchase only)
  const commissionHalala = Math.floor(
    (orderTotalHalala * settings.firstPurchasePercent) / 100,
  );

  // Check monthly cap
  const { data: monthlyData } = await db
    .from("referral_rewards")
    .select("amount_halala")
    .eq("reward_type", "commission")
    .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

  const monthlyTotal = (monthlyData ?? []).reduce(
    (sum, r) => sum + (r.amount_halala ?? 0),
    0,
  );

  const actualCommission = Math.min(
    commissionHalala,
    Math.max(0, settings.monthlyCapHalala - monthlyTotal),
  );

  // Credit commission to referrer's wallet
  if (actualCommission > 0) {
    await creditWallet(
      db,
      referral.referrerId,
      actualCommission,
      `Commission from referral order`,
      "commission",
      referral.id,
    );

    // Log the reward
    await db.from("referral_rewards").insert({
      referral_id: referral.id,
      reward_type: "commission",
      amount_halala: actualCommission,
      metadata: { order_id: orderId },
    });
  }

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
    spinsEarned: newSpinsToGrant,
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

  return { reversed: true, amountHalala: reward.amount_halala };
}
