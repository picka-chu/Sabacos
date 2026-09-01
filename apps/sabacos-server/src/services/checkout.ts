import {
  DEFAULT_DELIVERY_CONFIG,
  MIN_ORDER_SUBTOTAL_HALALA,
  computeDeliveryFee,
  formatETB,
  mergeDeliveryConfig,
  quoteDelivery,
  type DeliveryBreakdown,
  type CartItem,
  type Order,
} from "@sabacos/core";
import type { Db } from "../db/client.js";
import { getSettings } from "../db/settings.js";
import { clearCart, getCart } from "../db/cart.js";
import { createOrder } from "../db/orders.js";
import { getTotalDiscountForProfile } from "../db/waitlist.js";
import { computePromotionOrderDiscount, getActiveDiscounts } from "../db/discounts.js";
import { checkSpinnerCouponForCheckout, useSpinnerCoupon } from "../db/spinner.js";
import { getWalletBalance } from "../db/wallet.js";

export interface InvoicePriceLine {
  label: string;
  amount: number;
}

export interface CreateInvoiceLinkParams {
  payload: string;
  title: string;
  description: string;
  currency: string;
  prices: InvoicePriceLine[];
}

export interface CheckoutDeps {
  createInvoiceLink: (params: CreateInvoiceLinkParams) => Promise<string>;
}

export interface CheckoutInput {
  customerName: string;
  phone: string;
  address: string;
  note: string | null;
  latitude?: number | null;
  longitude?: number | null;
  zone?: number | null;
  deliveryType?: "standard" | "express";
  couponCode?: string;
  paymentMethod?: "telegram" | "wallet";
}

export interface CheckoutResult {
  order: Order;
  invoiceUrl: string | null;
  delivery: DeliveryBreakdown;
}

export class CartValidationError extends Error {
  constructor(
    message: string,
    public code:
      | "empty"
      | "inactive"
      | "insufficient_stock"
      | "min_order"
      | "invalid_coupon"
      | "wallet_insufficient",
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function validateCartItems(items: CartItem[]): Promise<void> {
  if (items.length === 0) throw new CartValidationError("Cart is empty", "empty");

  for (const item of items) {
    const product = item.product;
    if (!product.isActive) {
      throw new CartValidationError(
        `Product "${product.nameEn}" is no longer available`,
        "inactive",
        { [product.id]: "inactive" },
      );
    }
    if (item.qty > product.stock) {
      throw new CartValidationError(
        `Only ${product.stock} of "${product.nameEn}" are available`,
        "insufficient_stock",
        { [product.id]: `Only ${product.stock} available` },
      );
    }
  }
}

export async function checkout(
  db: Db,
  profileId: string,
  input: CheckoutInput,
  deps: CheckoutDeps,
): Promise<CheckoutResult> {
  const settings = await getSettings(db);
  const cart = await getCart(db, profileId);

  await validateCartItems(cart);

  const subtotalHalala = cart.reduce(
    (sum, i) => sum + i.product.priceHalala * i.qty,
    0,
  );

  if (subtotalHalala < MIN_ORDER_SUBTOTAL_HALALA) {
    throw new CartValidationError(
      `Minimum order is ${formatETB(MIN_ORDER_SUBTOTAL_HALALA)}`,
      "min_order",
    );
  }

  // Active promotions (global / category / product based) applied per item.
  const discounts = await getActiveDiscounts(db);
  const promo = computePromotionOrderDiscount(cart, discounts, subtotalHalala);

  // Waitlist / referral discount stacks on top of the promoted prices.
  const waitlistPercent = Math.min(await getTotalDiscountForProfile(db, profileId), 100);
  const waitlistDiscountHalala = waitlistPercent > 0
    ? Math.round((promo.effectiveSubtotalHalala * waitlistPercent) / 100)
    : 0;

  // Spinner coupon redemption (validated against the promo-discounted subtotal).
  let coupon: Awaited<ReturnType<typeof checkSpinnerCouponForCheckout>> | null = null;
  let couponDiscountHalala = 0;
  let couponLabel: string | null = null;
  if (input.couponCode) {
    coupon = await checkSpinnerCouponForCheckout(db, profileId, input.couponCode, promo.effectiveSubtotalHalala);
    if (!coupon.coupon) {
      const message =
        coupon.errorCode === "invalid" ? "Invalid or expired coupon"
        : coupon.errorCode === "not_owned" ? "This coupon belongs to another account"
        : coupon.errorCode === "used" ? "This coupon has already been used"
        : coupon.errorCode === "expired" ? "This coupon has expired"
        : "This coupon requires a higher order total";
      throw new CartValidationError(message, "invalid_coupon", { couponCode: coupon.errorCode });
    }
    couponDiscountHalala = coupon.discountHalala;
    couponLabel = coupon.label;
    const minOrder = coupon.coupon.minOrderHalala;
    if (minOrder > 0 && promo.effectiveSubtotalHalala < minOrder) {
      throw new CartValidationError(
        `Minimum order of ${formatETB(minOrder)} required for this coupon`,
        "invalid_coupon",
        { couponCode: "min_order" },
      );
    }
  }

  const discountHalala = promo.totalDiscountHalala + waitlistDiscountHalala + couponDiscountHalala;
  const discountedSubtotal = subtotalHalala - discountHalala;

  // Zone delivery pricing (GPS coords preferred, manual zone as fallback).
  // When no zone is resolved, fall back to the flat deliveryFeeHalala from
  // admin settings so the charge matches what the cart page displayed.
  const fragile = cart.some((i) => i.product.isFragile);
  let delivery;
  const config = settings.deliveryConfig
    ? mergeDeliveryConfig(settings.deliveryConfig)
    : DEFAULT_DELIVERY_CONFIG;
  const zoneEstimate = quoteDelivery(config, {
    subtotalHalala: discountedSubtotal,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    zone: input.zone ?? null,
    express: input.deliveryType === "express",
    fragile,
  });
  if (zoneEstimate.zone != null) {
    // GPS or manual zone resolved — use the zone-based quote.
    delivery = zoneEstimate;
  } else {
    // No zone available — use the flat admin fee (matches cart page).
    const flatFee = computeDeliveryFee(discountedSubtotal, settings.deliveryFeeHalala, settings.freeDeliveryThresholdHalala);
    delivery = {
      zone: null,
      baseFeeHalala: flatFee,
      zoneSurchargeHalala: 0,
      expressSurchargeHalala: input.deliveryType === "express" ? Math.round(flatFee * 0.5) : 0,
      fragileFeeHalala: fragile ? config.fragileFeeHalala : 0,
      totalDeliveryFeeHalala: (input.deliveryType === "express" ? flatFee + Math.round(flatFee * 0.5) : flatFee) + (fragile ? config.fragileFeeHalala : 0),
      freeDeliveryApplied: flatFee === 0,
      express: input.deliveryType === "express",
    };
  }
  const totalHalala = discountedSubtotal + delivery.totalDeliveryFeeHalala;

  const order = await createOrder(db, {
    profileId,
    subtotalHalala,
    discountHalala,
    discountPercent: waitlistPercent,
    deliveryFeeHalala: delivery.totalDeliveryFeeHalala,
    totalHalala,
    customerName: input.customerName,
    phone: input.phone,
    address: input.address,
    note: input.note ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    zone: delivery.zone,
    deliveryType: input.deliveryType === "express" ? "express" : "standard",
    fragile,
    items: cart.map((i) => ({
      productId: i.productId,
      nameEn: i.product.nameEn,
      nameAm: i.product.nameAm,
      sku: i.product.sku,
      priceHalala: i.product.priceHalala,
      qty: i.qty,
      subtotalHalala: i.product.priceHalala * i.qty,
    })),
  });

  // Redeem the spinner coupon against this order only after the order exists.
  if (coupon?.coupon) {
    await useSpinnerCoupon(db, coupon.coupon.id, order.id);
  }

  // Clear the cart now that the order is locked in (both payment paths).
  await clearCart(db, profileId);

  if (input.paymentMethod === "wallet") {
    return await finalizeWithWallet(db, order, totalHalala, delivery);
  }

  const prices: InvoicePriceLine[] = [
    ...cart.map((i) => ({
      label: `${i.product.nameEn} × ${i.qty}`,
      amount: i.product.priceHalala * i.qty,
    })),
  ];
  for (const line of promo.lines) {
    prices.push({ label: line.label, amount: -line.discountHalala });
  }
  if (waitlistDiscountHalala > 0) {
    prices.push({ label: `Waitlist discount (${waitlistPercent}%)`, amount: -waitlistDiscountHalala });
  }
  if (couponDiscountHalala > 0 && couponLabel) {
    prices.push({ label: couponLabel, amount: -couponDiscountHalala });
  }
  if (delivery.expressSurchargeHalala > 0) {
    if (delivery.baseFeeHalala + delivery.zoneSurchargeHalala > 0) {
      prices.push({
        label: "Delivery",
        amount: delivery.baseFeeHalala + delivery.zoneSurchargeHalala,
      });
    }
    prices.push({ label: "Express surcharge", amount: delivery.expressSurchargeHalala });
  } else if (delivery.totalDeliveryFeeHalala - delivery.fragileFeeHalala > 0) {
    prices.push({ label: "Delivery fee", amount: delivery.totalDeliveryFeeHalala - delivery.fragileFeeHalala });
  }
  if (delivery.fragileFeeHalala > 0) {
    prices.push({ label: "Fragile handling", amount: delivery.fragileFeeHalala });
  }

  let invoiceUrl: string;
  try {
    invoiceUrl = await deps.createInvoiceLink({
      payload: order.id,
      title: `${settings.shopNameEn ?? "Sabacos"} — Order ${order.orderNo}`,
      description: `${cart.length} item(s) · ${formatETB(totalHalala)}`,
      currency: "ETB",
      prices,
    });
  } catch {
    // If the invoice cannot be created the order is void — nothing was charged.
    try {
      await db.from("orders").update({ status: "cancelled", payment_status: "failed" }).eq("id", order.id);
    } catch {
      // best-effort
    }
    throw new CartValidationError("Could not create payment link. Please try again.", "min_order");
  }

  return { order, invoiceUrl, delivery };
}

/**
 * Pays for an order from the customer's referral wallet, then finalizes it the
 * same way a successful Telegram charge would (decrement stock, mark paid,
 * trigger referral rewards).
 */
async function finalizeWithWallet(
  db: Db,
  order: Order,
  totalHalala: number,
  delivery: DeliveryBreakdown,
): Promise<CheckoutResult> {
  const balance = await getWalletBalance(db, order.profileId);
  if (balance < totalHalala) {
    throw new CartValidationError(
      `Insufficient wallet balance: ${formatETB(balance)} < ${formatETB(totalHalala)}`,
      "wallet_insufficient",
    );
  }

  const { data: status, error } = await db.rpc("finalize_wallet_payment", {
    p_order_id: order.id,
    p_amount_halala: totalHalala,
  });
  if (error) {
    try {
      await db
        .from("orders")
        .update({ status: "cancelled", payment_status: "failed" })
        .eq("id", order.id);
    } catch {
      // Order cancellation is best-effort here.
    }
    throw new CartValidationError(`Wallet payment failed: ${error.message}`, "wallet_insufficient");
  }
  if (status !== "ok") {
    throw new CartValidationError(`Wallet payment failed (${status})`, "wallet_insufficient");
  }

  // Credit referral rewards (commission + spins) just like a paid order.
  const { processReferralReward } = await import("../db/referral-rewards.js");
  await processReferralReward(db, {
    referredProfileId: order.profileId,
    orderId: order.id,
    orderTotalHalala: order.totalHalala,
  }).catch((err) => console.error("wallet checkout: referral reward failed", err));

  return { order, invoiceUrl: null, delivery };
}