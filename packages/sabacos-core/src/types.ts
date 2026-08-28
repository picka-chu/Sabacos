import type { DeliveryConfig } from "./delivery.js";

export const CURRENCY = "ETB" as const;
export const CURRENCY_LABEL = "ETB" as const;
export const HALALA_PER_ETB = 100;

export const DEFAULT_DELIVERY_FEE_HALALA = 12000;
export const DEFAULT_FREE_DELIVERY_THRESHOLD_HALALA = 150000;

export const ORDER_PREFIX = "SB";
export const MIN_ORDER_SUBTOTAL_HALALA = 10000;
export const MAX_CART_QTY = 99;

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export const PAYMENT_STATUSES = [
  "pending",
  "success",
  "failed",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type ProfileRole = "customer" | "staff" | "delivery" | "admin";

export const PROFILE_ROLES: readonly ProfileRole[] = ["customer", "staff", "delivery", "admin"] as const;

/** Roles that can access the admin dashboard (any level). */
export const ADMIN_ROLES: readonly ProfileRole[] = ["staff", "delivery", "admin"] as const;

/** Roles that have full admin privileges. */
export const FULL_ADMIN_ROLES: readonly ProfileRole[] = ["admin"] as const;

export function isAdminRole(role: ProfileRole): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export function isFullAdmin(role: ProfileRole): boolean {
  return (FULL_ADMIN_ROLES as readonly string[]).includes(role);
}

export interface Profile {
  id: string;
  telegramId: number | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  photoUrl: string | null;
  /** Latest GPS pin the user shared with the bot (powers zone pricing). */
  lastLatitude: number | null;
  lastLongitude: number | null;
  role: ProfileRole;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  slug: string;
  nameEn: string;
  nameAm: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductPromo {
  /** Effective discount percentage shown on the sale badge (e.g. 15 = "-15%"). */
  percent: number;
  salePriceHalala: number;
  endsAt: string | null;
}

export interface Product {
  id: string;
  categoryId: string | null;
  sku: string;
  nameEn: string;
  nameAm: string;
  descriptionEn: string;
  descriptionAm: string;
  priceHalala: number;
  costHalala: number;
  compareAtHalala: number | null;
  stock: number;
  imageUrls: string[];
  isActive: boolean;
  isFeatured: boolean;
  isFragile: boolean;
  createdAt: string;
  updatedAt: string;
  /** Set by the catalog/cart routes when an active promotion covers this product. */
  promo?: ProductPromo | null;
}

export interface CartItem {
  id: string;
  productId: string;
  qty: number;
  createdAt: string;
  updatedAt: string;
  product: Product;
}

export type DeliveryType = "standard" | "express";

export interface Order {
  id: string;
  orderNo: string;
  profileId: string;
  status: OrderStatus;
  subtotalHalala: number;
  discountHalala: number;
  discountPercent: number;
  deliveryFeeHalala: number;
  totalHalala: number;
  customerName: string;
  phone: string;
  address: string;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  zone: number | null;
  deliveryType: DeliveryType;
  fragile: boolean;
  invoicePayload: string;
  telegramPaymentChargeId: string | null;
  providerPaymentChargeId: string | null;
  paymentStatus: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  nameEn: string;
  nameAm: string;
  sku: string;
  priceHalala: number;
  qty: number;
  subtotalHalala: number;
}

export interface Payment {
  id: string;
  orderId: string;
  amountHalala: number;
  currency: string;
  provider: string;
  status: PaymentStatus;
  telegramPaymentId: string | null;
  providerChargeId: string | null;
  createdAt: string;
}

export interface Settings {
  deliveryFeeHalala: number;  freeDeliveryThresholdHalala: number;
  shopNameEn: string;
  shopNameAm: string;
  shopPhone: string;
  adminChannelId: string | null;
  deliveryConfig?: DeliveryConfig | null;
}

export interface OrderTotals {
  subtotalHalala: number;
  deliveryFeeHalala: number;
  totalHalala: number;
}

export interface CartSummary {
  items: CartItem[];
  itemCount: number;
  totals: OrderTotals;
  deliveryFeeHalala: number;
  freeDeliveryThresholdHalala: number;
  /** Combined halala discount from active promotions applied to this cart. */
  discountHalala?: number;
  discountLabel?: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export type OrderWithItems = Order & { items: OrderItem[]; profile?: Profile | null };

// ──────────────────────────────────────────────────────────────────────
// Referral & Rewards
// ──────────────────────────────────────────────────────────────────────

export type ReferralStatus = "pending" | "qualified" | "expired";
export const REFERRAL_STATUSES: readonly ReferralStatus[] = ["pending", "qualified", "expired"] as const;

export type ReferralRewardType = "commission" | "spin_credit" | "spin_granted";
export const REFERRAL_REWARD_TYPES: readonly ReferralRewardType[] = ["commission", "spin_credit", "spin_granted"] as const;

export interface Referral {
  id: string;
  referrerId: string;
  referredId: string;
  referralCode: string;
  status: ReferralStatus;
  qualifiedAt: string | null;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralReward {
  id: string;
  referralId: string;
  rewardType: ReferralRewardType;
  amountHalala: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Wallet
// ──────────────────────────────────────────────────────────────────────

export type WalletTransactionType = "credit" | "debit" | "refund";
export const WALLET_TRANSACTION_TYPES: readonly WalletTransactionType[] = ["credit", "debit", "refund"] as const;

export interface WalletCredit {
  id: string;
  profileId: string;
  balanceHalala: number;
  createdAt: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: WalletTransactionType;
  amountHalala: number;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Spinner
// ──────────────────────────────────────────────────────────────────────

export type SpinnerSpinStatus = "available" | "used" | "expired";
export const SPINNER_SPIN_STATUSES: readonly SpinnerSpinStatus[] = ["available", "used", "expired"] as const;

export type SpinnerPrizeType = "coupon_percent" | "coupon_fixed" | "free_product" | "spin_again";
export const SPINNER_PRIZE_TYPES: readonly SpinnerPrizeType[] = ["coupon_percent", "coupon_fixed", "free_product", "spin_again"] as const;

export interface SpinnerSpin {
  id: string;
  profileId: string;
  status: SpinnerSpinStatus;
  wonPrizeId: string | null;
  wonAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface SpinnerPrize {
  id: string;
  name: string;
  prizeType: SpinnerPrizeType;
  value: number;
  productId: string | null;
  weight: number;
  maxPool: number | null;
  currentPool: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Spinner Coupons
// ──────────────────────────────────────────────────────────────────────

export type SpinnerCouponDiscountType = "percent" | "fixed";
export const SPINNER_COUPON_DISCOUNT_TYPES: readonly SpinnerCouponDiscountType[] = ["percent", "fixed"] as const;

export interface SpinnerCoupon {
  id: string;
  profileId: string;
  spinId: string;
  code: string;
  discountType: SpinnerCouponDiscountType;
  discountValue: number;
  minOrderHalala: number;
  isUsed: boolean;
  usedAt: string | null;
  orderId: string | null;
  expiresAt: string;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Referral Settings
// ──────────────────────────────────────────────────────────────────────

export interface ReferralSettings {
  id: string;
  isActive: boolean;
  firstPurchasePercent: number;
  repeatPurchasePercent: number;
  monthlyCapHalala: number;
  referralsPerSpin: number;
  maxSpinsPerWeek: number;
  spinExpiryDays: number;
  couponExpiryDays: number;
  maxCouponsPerOrder: number;
  minAccountAgeDays: number;
  minOrderValueHalala: number;
  // Adaptive engine
  rewardBudgetPct: number;
  topPrizeCostHalala: number;
  adaptiveEnabled: boolean;
  lastAdjustmentDate: string | null;
  adjustmentDayOfWeek: number;
  // Daily spend cap
  dailySpendCapHalala: number;
  dailySpendCapEnabled: boolean;
  // Guardrails
  guardrailCommissionMin: number;
  guardrailCommissionMax: number;
  guardrailSpinCapMin: number;
  guardrailSpinCapMax: number;
  guardrailPrizeCostMin: number;
  guardrailPrizeCostMax: number;
  guardrailMaxBudgetPct: number;
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Referral Program Helpers
// ──────────────────────────────────────────────────────────────────────

/** Generate a referral code from a Telegram ID. */
export function generateReferralCode(telegramId: number): string {
  return `ref${telegramId}`;
}

/** Build the bot deep link URL for sharing a referral. */
export function referralDeepLink(botUsername: string, telegramId: number): string {
  return `https://t.me/${botUsername}?start=${generateReferralCode(telegramId)}`;
}

/** Calculate commission amount from order total and percent. */
export function calculateCommission(orderTotalHalala: number, percent: number): number {
  return Math.floor((orderTotalHalala * percent) / 100);
}