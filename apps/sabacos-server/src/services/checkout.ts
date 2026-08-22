import {
  MIN_ORDER_SUBTOTAL_HALALA,
  formatETB,
  type CartItem,
  type Order,
} from "@sabacos/core";
import type { Db } from "../db/client.js";
import { getSettings } from "../db/settings.js";
import { clearCart, getCart } from "../db/cart.js";
import { createOrder } from "../db/orders.js";
import { computeTotals } from "@sabacos/core";

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
}

export interface CheckoutResult {
  order: Order;
  invoiceUrl: string;
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

  const totals = computeTotals(
    cart.map((i) => ({ priceHalala: i.product.priceHalala, qty: i.qty })),
    settings.deliveryFeeHalala,
    settings.freeDeliveryThresholdHalala,
  );

  if (totals.subtotalHalala < MIN_ORDER_SUBTOTAL_HALALA) {
    throw new CartValidationError(
      `Minimum order is ${formatETB(MIN_ORDER_SUBTOTAL_HALALA)}`,
      "min_order",
    );
  }

  const order = await createOrder(db, {
    profileId,
    subtotalHalala: totals.subtotalHalala,
    deliveryFeeHalala: totals.deliveryFeeHalala,
    totalHalala: totals.totalHalala,
    customerName: input.customerName,
    phone: input.phone,
    address: input.address,
    note: input.note ?? null,
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
  if (totals.deliveryFeeHalala > 0) {
    prices.push({ label: "Delivery fee", amount: totals.deliveryFeeHalala });
  }

  let invoiceUrl: string;
  try {
    invoiceUrl = await deps.createInvoiceLink({
      payload: order.id,
      title: `${settings.shopNameEn ?? "Sabacos"} — Order ${order.orderNo}`,
      description: `${cart.length} item(s) · ${formatETB(totals.totalHalala)}`,
      currency: "ETB",
      prices,
    });
  } finally {
    await clearCart(db, profileId);
  }

  return { order, invoiceUrl };
}