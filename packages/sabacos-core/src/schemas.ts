import { z } from "zod";
import { MAX_CART_QTY } from "./types.js";
import { mergeDeliveryConfig } from "./delivery.js";
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type Category,
  type Order,
  type OrderItem,
  type Payment,
  type Product,
  type Profile,
  type Settings,
} from "./types.js";

export const uuidSchema = z.uuid();

// ---- DB row schemas (snake_case input -> camelCase domain output) ----

export const profileRowSchema = z
  .object({
    id: z.uuid(),
    telegram_id: z.number().int().nullable(),
    username: z.string().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    photo_url: z.string().nullable(),
    last_latitude: z.number().nullable().optional(),
    last_longitude: z.number().nullable().optional(),
    role: z.enum(["customer", "admin"]),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (r): Profile => ({
      id: r.id,
      telegramId: r.telegram_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: r.phone,
      address: r.address,
      photoUrl: r.photo_url,
      lastLatitude: r.last_latitude ?? null,
      lastLongitude: r.last_longitude ?? null,
      role: r.role,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  );

export const categoryRowSchema = z
  .object({
    id: z.uuid(),
    slug: z.string().min(1),
    name_en: z.string().min(1),
    name_am: z.string().min(1),
    sort_order: z.number().int(),
    is_active: z.boolean(),
  })
  .transform(
    (r): Category => ({
      id: r.id,
      slug: r.slug,
      nameEn: r.name_en,
      nameAm: r.name_am,
      sortOrder: r.sort_order,
      isActive: r.is_active,
    }),
  );

export const productRowSchema = z
  .object({
    id: z.uuid(),
    category_id: z.uuid().nullable(),
    sku: z.string().min(1),
    name_en: z.string().min(1),
    name_am: z.string().min(1),
    description_en: z.string().default(""),
    description_am: z.string().default(""),
    price_halala: z.number().int().nonnegative(),
    compare_at_halala: z.number().int().nonnegative().nullable(),
    stock: z.number().int().nonnegative(),
    image_urls: z.array(z.string()),
    is_active: z.boolean(),
    is_featured: z.boolean(),
    is_fragile: z.boolean().default(false),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (r): Product => ({
      id: r.id,
      categoryId: r.category_id,
      sku: r.sku,
      nameEn: r.name_en,
      nameAm: r.name_am,
      descriptionEn: r.description_en,
      descriptionAm: r.description_am,
      priceHalala: r.price_halala,
      compareAtHalala: r.compare_at_halala,
      stock: r.stock,
      imageUrls: r.image_urls,
      isActive: r.is_active,
      isFeatured: r.is_featured,
      isFragile: r.is_fragile ?? false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  );

export const orderRowSchema = z
  .object({
    id: z.uuid(),
    order_no: z.string(),
    profile_id: z.uuid(),
    status: z.enum(ORDER_STATUSES),
    subtotal_halala: z.number().int().nonnegative(),
    delivery_fee_halala: z.number().int().nonnegative(),
    total_halala: z.number().int().nonnegative(),
    customer_name: z.string().min(1),
    phone: z.string().min(1),
    address: z.string().min(1),
    note: z.string().nullable(),
    latitude: z.number().nullable().default(null),
    longitude: z.number().nullable().default(null),
    zone: z.number().int().min(1).max(5).nullable().default(null),
    delivery_type: z.enum(["standard", "express"]).default("standard"),
    fragile: z.boolean().default(false),
    invoice_payload: z.string(),
    telegram_payment_charge_id: z.string().nullable(),
    provider_payment_charge_id: z.string().nullable(),
    payment_status: z.enum(PAYMENT_STATUSES),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (r): Order => ({
      id: r.id,
      orderNo: r.order_no,
      profileId: r.profile_id,
      status: r.status,
      subtotalHalala: r.subtotal_halala,
      deliveryFeeHalala: r.delivery_fee_halala,
      totalHalala: r.total_halala,
      customerName: r.customer_name,
      phone: r.phone,
      address: r.address,
      note: r.note,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      zone: r.zone ?? null,
      deliveryType: r.delivery_type ?? "standard",
      fragile: r.fragile ?? false,
      invoicePayload: r.invoice_payload,
      telegramPaymentChargeId: r.telegram_payment_charge_id,
      providerPaymentChargeId: r.provider_payment_charge_id,
      paymentStatus: r.payment_status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }),
  );

export const orderItemRowSchema = z
  .object({
    id: z.uuid(),
    order_id: z.uuid(),
    product_id: z.uuid(),
    name_en: z.string(),
    name_am: z.string(),
    sku: z.string(),
    price_halala: z.number().int().nonnegative(),
    qty: z.number().int().positive(),
    subtotal_halala: z.number().int().nonnegative(),
  })
  .transform(
    (r): OrderItem => ({
      id: r.id,
      orderId: r.order_id,
      productId: r.product_id,
      nameEn: r.name_en,
      nameAm: r.name_am,
      sku: r.sku,
      priceHalala: r.price_halala,
      qty: r.qty,
      subtotalHalala: r.subtotal_halala,
    }),
  );

export const paymentRowSchema = z
  .object({
    id: z.uuid(),
    order_id: z.uuid(),
    amount_halala: z.number().int().nonnegative(),
    currency: z.string(),
    provider: z.string(),
    status: z.enum(PAYMENT_STATUSES),
    telegram_payment_id: z.string().nullable(),
    provider_charge_id: z.string().nullable(),
    created_at: z.string(),
  })
  .transform(
    (r): Payment => ({
      id: r.id,
      orderId: r.order_id,
      amountHalala: r.amount_halala,
      currency: r.currency,
      provider: r.provider,
      status: r.status,
      telegramPaymentId: r.telegram_payment_id,
      providerChargeId: r.provider_charge_id,
      createdAt: r.created_at,
    }),
  );

const settingsFieldsSchema = z.object({
  delivery_fee_halala: z.number().int().nonnegative(),
  free_delivery_threshold_halala: z.number().int().nonnegative(),
  shop_name_en: z.string().min(1),
  shop_name_am: z.string().min(1),
  shop_phone: z.string(),
  admin_channel_id: z.string().nullable(),
  delivery_config: z.unknown().optional(),
});

export const settingsRowSchema = settingsFieldsSchema.transform(
  (r): Settings => ({
    deliveryFeeHalala: r.delivery_fee_halala,
    freeDeliveryThresholdHalala: r.free_delivery_threshold_halala,
    shopNameEn: r.shop_name_en,
    shopNameAm: r.shop_name_am,
    shopPhone: r.shop_phone,
    adminChannelId: r.admin_channel_id,
    deliveryConfig:
      r.delivery_config != null ? mergeDeliveryConfig(r.delivery_config) : null,
  }),
);

export const cartItemRowSchema = z.object({
  id: z.uuid(),
  profile_id: z.uuid(),
  product_id: z.uuid(),
  qty: z.number().int().min(1).max(MAX_CART_QTY),
  created_at: z.string(),
  updated_at: z.string(),
});

// ---- Raw row input types (for DB writes) ----

export type ProfileRow = z.input<typeof profileRowSchema>;
export type CategoryRow = z.input<typeof categoryRowSchema>;
export type ProductRow = z.input<typeof productRowSchema>;
export type OrderRow = z.input<typeof orderRowSchema>;
export type OrderItemRow = z.input<typeof orderItemRowSchema>;
export type PaymentRow = z.input<typeof paymentRowSchema>;
export type SettingsRow = z.input<typeof settingsRowSchema>;
export type CartItemRow = z.input<typeof cartItemRowSchema>;

// ---- API request payloads (camelCase) ----

export const addCartItemSchema = z.object({
  productId: z.uuid(),
  qty: z.number().int().min(1).max(MAX_CART_QTY),
});

export const patchCartItemSchema = z.object({
  qty: z.number().int().min(1).max(MAX_CART_QTY),
});

export const checkoutSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(3).max(30),
  address: z.string().trim().min(5).max(500),
  note: z.string().trim().max(500).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  /** Manual zone (1-based) when GPS is unavailable. */
  zone: z.number().int().min(1).max(5).optional().nullable(),
  deliveryType: z.enum(["standard", "express"]).optional(),
});

export const createProductSchema = z.object({
  categoryId: z.uuid().nullable().optional(),
  sku: z.string().trim().min(1).max(64),
  nameEn: z.string().trim().min(1).max(200),
  nameAm: z.string().trim().min(1).max(200),
  descriptionEn: z.string().trim().max(2000).optional(),
  descriptionAm: z.string().trim().max(2000).optional(),
  priceHalala: z.number().int().nonnegative(),
  compareAtHalala: z.number().int().nonnegative().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  imageUrls: z.array(z.string().url()).max(12).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isFragile: z.boolean().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const createCategorySchema = z.object({
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/i),
  nameEn: z.string().trim().min(1).max(120),
  nameAm: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export const updateSettingsSchema = settingsFieldsSchema.partial();

export const initDataPayloadSchema = z.object({
  queryId: z.string(),
  userId: z.number().int().positive(),
  authDate: z.number().int().positive(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  hash: z.string(),
  raw: z.string(),
});

export type InitDataPayload = z.infer<typeof initDataPayloadSchema>;