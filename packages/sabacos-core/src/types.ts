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
export type ProfileRole = "customer" | "admin";

export interface Profile {
  id: string;
  telegramId: number | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
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

export interface Product {
  id: string;
  categoryId: string | null;
  sku: string;
  nameEn: string;
  nameAm: string;
  descriptionEn: string;
  descriptionAm: string;
  priceHalala: number;
  compareAtHalala: number | null;
  stock: number;
  imageUrls: string[];
  isActive: boolean;
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  id: string;
  productId: string;
  qty: number;
  createdAt: string;
  updatedAt: string;
  product: Product;
}

export interface Order {
  id: string;
  orderNo: string;
  profileId: string;
  status: OrderStatus;
  subtotalHalala: number;
  deliveryFeeHalala: number;
  totalHalala: number;
  customerName: string;
  phone: string;
  address: string;
  note: string | null;
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
  deliveryFeeHalala: number;
  freeDeliveryThresholdHalala: number;
  shopNameEn: string;
  shopNameAm: string;
  shopPhone: string;
  adminChannelId: string | null;
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
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export type OrderWithItems = Order & { items: OrderItem[]; profile?: Profile | null };