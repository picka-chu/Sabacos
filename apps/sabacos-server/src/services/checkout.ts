import {
  DEFAULT_DELIVERY_CONFIG,
  MIN_ORDER_SUBTOTAL_HALALA,
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
}

export interface CheckoutResult {
  order: Order;
  invoiceUrl: string;
  delivery: DeliveryBreakdown;
}

export class CartValidationError extends Error {
  constructor(
    message: string,
    public code: "empty" | "inactive" | "insufficient_stock" | "min_order",
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

  // Zone delivery pricing (GPS coords preferred, manual zone as fallback).
  const fragile = cart.some((i) => i.product.isFragile);
  const config = settings.deliveryConfig
    ? mergeDeliveryConfig(settings.deliveryConfig)
    : DEFAULT_DELIVERY_CONFIG;
  const delivery = quoteDelivery(config, {
    subtotalHalala,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    zone: input.zone ?? null,
    express: input.deliveryType === "express",
    fragile,
  });
  const totalHalala = subtotalHalala + delivery.totalDeliveryFeeHalala;

  const order = await createOrder(db, {
    profileId,
    subtotalHalala,
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

  const prices: InvoicePriceLine[] = [
    ...cart.map((i) => ({
      label: `${i.product.nameEn} × ${i.qty}`,
      amount: i.product.priceHalala * i.qty,
    })),
  ];
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
  } finally {
    await clearCart(db, profileId);
  }

  return { order, invoiceUrl, delivery };
}