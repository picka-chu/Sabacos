import type { Db } from "./client.js";
import {
  spinnerSpinRowSchema,
  spinnerPrizeRowSchema,
  spinnerCouponRowSchema,
  type SpinnerSpin,
  type SpinnerPrize,
  type SpinnerCoupon,
} from "@sabacos/core";

// ──────────────────────────────────────────────────────────────────────
// Spinner Prizes
// ──────────────────────────────────────────────────────────────────────

/** Get all active spinner prizes. */
export async function getActiveSpinnerPrizes(db: Db): Promise<SpinnerPrize[]> {
  const { data, error } = await db
    .from("spinner_prizes")
    .select("*")
    .eq("is_active", true)
    .order("weight", { ascending: false });

  if (error) throw new Error(`getActiveSpinnerPrizes: ${error.message}`);
  return (data ?? []).map((r) => spinnerPrizeRowSchema.parse(r));
}

/** Get a spinner prize by ID. */
export async function getSpinnerPrizeById(
  db: Db,
  id: string,
): Promise<SpinnerPrize | null> {
  const { data, error } = await db
    .from("spinner_prizes")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return spinnerPrizeRowSchema.parse(data);
}

/** Create a new spinner prize. */
export async function createSpinnerPrize(
  db: Db,
  prize: Omit<SpinnerPrize, "id" | "createdAt" | "updatedAt">,
): Promise<SpinnerPrize> {
  const { data, error } = await db
    .from("spinner_prizes")
    .insert({
      name: prize.name,
      prize_type: prize.prizeType,
      value: prize.value,
      product_id: prize.productId,
      weight: prize.weight,
      max_pool: prize.maxPool,
      current_pool: prize.currentPool,
      is_active: prize.isActive,
    })
    .select()
    .single();

  if (error) throw new Error(`createSpinnerPrize: ${error.message}`);
  return spinnerPrizeRowSchema.parse(data);
}

/** Update a spinner prize. */
export async function updateSpinnerPrize(
  db: Db,
  id: string,
  updates: Partial<Omit<SpinnerPrize, "id" | "createdAt" | "updatedAt">>,
): Promise<SpinnerPrize> {
  const { data, error } = await db
    .from("spinner_prizes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`updateSpinnerPrize: ${error.message}`);
  return spinnerPrizeRowSchema.parse(data);
}

// ──────────────────────────────────────────────────────────────────────
// Spinner Spins
// ──────────────────────────────────────────────────────────────────────

/** Get available spins for a user. */
export async function getAvailableSpins(
  db: Db,
  profileId: string,
): Promise<SpinnerSpin[]> {
  const { data, error } = await db
    .from("spinner_spins")
    .select("*")
    .eq("profile_id", profileId)
    .eq("status", "available")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`getAvailableSpins: ${error.message}`);
  return (data ?? []).map((r) => spinnerSpinRowSchema.parse(r));
}

/** Count available spins for a user. */
export async function countAvailableSpins(
  db: Db,
  profileId: string,
): Promise<number> {
  const { count, error } = await db
    .from("spinner_spins")
    .select("*", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("status", "available");

  if (error) throw new Error(`countAvailableSpins: ${error.message}`);
  return count ?? 0;
}

/** Get all spins for a user (including used/expired). */
export async function getAllSpins(
  db: Db,
  profileId: string,
): Promise<SpinnerSpin[]> {
  const { data, error } = await db
    .from("spinner_spins")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getAllSpins: ${error.message}`);
  return (data ?? []).map((r) => spinnerSpinRowSchema.parse(r));
}

/** Use a spin and return the prize won (weighted random selection). */
export async function useSpin(
  db: Db,
  spinId: string,
): Promise<{ spin: SpinnerSpin; prize: SpinnerPrize }> {
  // Get the spin
  const { data: spinData, error: spinErr } = await db
    .from("spinner_spins")
    .select("*")
    .eq("id", spinId)
    .eq("status", "available")
    .single();

  if (spinErr || !spinData) throw new Error("Spin not found or already used");
  if (spinData.expires_at && new Date(spinData.expires_at) < new Date()) {
    throw new Error("Spin has expired");
  }

  // Get active prizes
  const prizes = await getActiveSpinnerPrizes(db);
  if (prizes.length === 0) throw new Error("No prizes available");

  // Filter prizes with available pool
  const availablePrizes = prizes.filter(
    (p) => p.maxPool === null || p.currentPool < p.maxPool,
  );

  if (availablePrizes.length === 0) throw new Error("All prizes out of stock");

  // Weighted random selection
  const totalWeight = availablePrizes.reduce((sum, p) => sum + p.weight, 0);
  let random = Math.random() * totalWeight;
  const firstPrize = availablePrizes[0]!;
  let selectedPrize = firstPrize;

  for (const prize of availablePrizes) {
    random -= prize.weight;
    if (random <= 0) {
      selectedPrize = prize;
      break;
    }
  }

  // Decrement pool if limited
  if (selectedPrize.maxPool !== null) {
    const { error: poolErr } = await db
      .from("spinner_prizes")
      .update({ current_pool: selectedPrize.currentPool + 1 })
      .eq("id", selectedPrize.id);

    if (poolErr) throw new Error(`Failed to update prize pool: ${poolErr.message}`);
  }

  // Mark spin as used
  const { data: updatedSpin, error: updateErr } = await db
    .from("spinner_spins")
    .update({
      status: "used",
      won_prize_id: selectedPrize.id,
      won_at: new Date().toISOString(),
    })
    .eq("id", spinId)
    .select()
    .single();

  if (updateErr) throw new Error(`Failed to mark spin as used: ${updateErr.message}`);

  return {
    spin: spinnerSpinRowSchema.parse(updatedSpin),
    prize: selectedPrize,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Spinner Coupons
// ──────────────────────────────────────────────────────────────────────

/** Create a coupon from a spin win. */
export async function createSpinnerCoupon(
  db: Db,
  params: {
    profileId: string;
    spinId: string;
    code: string;
    discountType: "percent" | "fixed";
    discountValue: number;
    minOrderHalala?: number;
    expiresAt: Date;
  },
): Promise<SpinnerCoupon> {
  const { data, error } = await db
    .from("spinner_coupons")
    .insert({
      profile_id: params.profileId,
      spin_id: params.spinId,
      code: params.code,
      discount_type: params.discountType,
      discount_value: params.discountValue,
      min_order_halala: params.minOrderHalala ?? 0,
      is_used: false,
      expires_at: params.expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`createSpinnerCoupon: ${error.message}`);
  return spinnerCouponRowSchema.parse(data);
}

/** Get a coupon by code. */
export async function getSpinnerCouponByCode(
  db: Db,
  code: string,
): Promise<SpinnerCoupon | null> {
  const { data, error } = await db
    .from("spinner_coupons")
    .select("*")
    .eq("code", code)
    .single();

  if (error || !data) return null;
  return spinnerCouponRowSchema.parse(data);
}

export type SpinnerCouponCheck =
  | { coupon: SpinnerCoupon; discountHalala: number; label: string }
  | { coupon: null; errorCode: "invalid" | "not_owned" | "used" | "expired" | "min_order" };

/**
 * Validate a spinner coupon code for checkout and compute its discount.
 * Returns an errorCode instead of throwing so it can be used for cart previews too.
 * `baseSubtotalHalala` is the subtotal the discount applies to (after promotions).
 */
export async function checkSpinnerCouponForCheckout(
  db: Db,
  profileId: string,
  couponCode: string,
  baseSubtotalHalala: number,
): Promise<SpinnerCouponCheck> {
  const coupon = await getSpinnerCouponByCode(db, couponCode);
  if (!coupon) return { coupon: null, errorCode: "invalid" };
  if (coupon.profileId !== profileId) return { coupon: null, errorCode: "not_owned" };
  if (coupon.isUsed) return { coupon: null, errorCode: "used" };
  if (new Date(coupon.expiresAt).getTime() <= Date.now()) return { coupon: null, errorCode: "expired" };
  if (baseSubtotalHalala < coupon.minOrderHalala) return { coupon: null, errorCode: "min_order" };

  const discountHalala =
    coupon.discountType === "percent"
      ? Math.round((baseSubtotalHalala * coupon.discountValue) / 100)
      : Math.min(coupon.discountValue, baseSubtotalHalala);

  return {
    coupon,
    discountHalala,
    label:
      coupon.discountType === "percent"
        ? `Coupon (${coupon.discountValue}%)`
        : `Coupon (${coupon.code})`,
  };
}

/** Get valid (unused, unexpired) coupons for a user. */
export async function getValidCoupons(
  db: Db,
  profileId: string,
): Promise<SpinnerCoupon[]> {
  const { data, error } = await db
    .from("spinner_coupons")
    .select("*")
    .eq("profile_id", profileId)
    .eq("is_used", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getValidCoupons: ${error.message}`);
  return (data ?? []).map((r) => spinnerCouponRowSchema.parse(r));
}

/** Mark a coupon as used. */
export async function useSpinnerCoupon(
  db: Db,
  couponId: string,
  orderId: string,
): Promise<void> {
  const { error } = await db
    .from("spinner_coupons")
    .update({
      is_used: true,
      used_at: new Date().toISOString(),
      order_id: orderId,
    })
    .eq("id", couponId);

  if (error) throw new Error(`useSpinnerCoupon: ${error.message}`);
}

/** Check if user has already used a spinner coupon on this order. */
export async function hasUsedSpinnerCouponOnOrder(
  db: Db,
  profileId: string,
  orderId: string,
): Promise<boolean> {
  const { count, error } = await db
    .from("spinner_coupons")
    .select("*", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("order_id", orderId)
    .eq("is_used", true);

  if (error) throw new Error(`hasUsedSpinnerCouponOnOrder: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Generate a unique coupon code. */
export function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I/O/0/1 to avoid confusion
  let code = "SPIN-";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
