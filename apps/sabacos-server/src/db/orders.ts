import {
  orderItemRowSchema,
  orderRowSchema,
  type Order,
  type OrderItem,
  type OrderStatus,
  type OrderWithItems,
  type PaymentMethod,
  type PaymentStatus,
} from "@sabacos/core";
import type { Db } from "./client.js";

export interface CreateOrderInput {
  profileId: string;
  subtotalHalala: number;
  discountHalala: number;
  discountPercent: number;
  deliveryFeeHalala: number;
  totalHalala: number;
  customerName: string;
  phone: string;
  address: string;
  note: string | null;
  latitude?: number | null;
  longitude?: number | null;
  zone?: number | null;
  deliveryType?: "standard" | "express";
  fragile?: boolean;
  paymentMethod?: PaymentMethod;
  /** Resolved + validated share attribution (referrer profile id) or null. */
  attributedToProfileId?: string | null;
  items: Array<{
    productId: string;
    nameEn: string;
    nameAm: string;
    sku: string;
    priceHalala: number;
    qty: number;
    subtotalHalala: number;
  }>;
}

export async function createOrder(db: Db, input: CreateOrderInput): Promise<Order> {
  const { data, error } = await db.rpc("create_order", {
    p_order: {
      profile_id: input.profileId,
      subtotal_halala: input.subtotalHalala,
      discount_halala: input.discountHalala,
      discount_percent: input.discountPercent,
      delivery_fee_halala: input.deliveryFeeHalala,
      total_halala: input.totalHalala,
      customer_name: input.customerName,
      phone: input.phone,
      address: input.address,
      note: input.note ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      zone: input.zone ?? null,
      delivery_type: input.deliveryType ?? "standard",
      fragile: input.fragile ?? false,
      payment_method: input.paymentMethod ?? "telegram",
      attributed_to_profile_id: input.attributedToProfileId ?? null,
      items: input.items.map((item) => ({
        product_id: item.productId,
        name_en: item.nameEn,
        name_am: item.nameAm,
        sku: item.sku,
        price_halala: item.priceHalala,
        qty: item.qty,
        subtotal_halala: item.subtotalHalala,
      })),
    },
  });
  if (error) throw new Error(`createOrder: ${error.message}`);
  return orderRowSchema.parse(data);
}

const ORDER_COLUMNS = [
  "id",
  "order_no",
  "profile_id",
  "status",
  "subtotal_halala",
  "discount_halala",
  "discount_percent",
  "delivery_fee_halala",
  "total_halala",
  "customer_name",
  "phone",
  "address",
  "note",
  "latitude",
  "longitude",
  "zone",
  "delivery_type",
  "fragile",
  "invoice_payload",
  "telegram_payment_charge_id",
  "provider_payment_charge_id",
  "payment_status",
  "payment_method",
  "deposit_halala",
  "balance_halala",
  "bank_account_id",
  "payment_proof_url",
  "payment_proof_status",
  "payment_proof_rejection_reason",
  "attributed_to_profile_id",
  "created_at",
  "updated_at",
].join(", ");

export async function getOrderById(db: Db, id: string): Promise<Order | null> {
  const { data, error } = await db.from("orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`getOrderById: ${error.message}`);
  return data ? orderRowSchema.parse(data) : null;
}

export async function getOrdersByProfile(db: Db, profileId: string): Promise<Order[]> {
  const { data, error } = await db
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`getOrdersByProfile: ${error.message}`);
  return (data ?? []).map((row) => orderRowSchema.parse(row));
}

export async function getOrderItems(db: Db, orderId: string): Promise<OrderItem[]> {
  const { data, error } = await db
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("name_en", { ascending: true });
  if (error) throw new Error(`getOrderItems: ${error.message}`);
  return (data ?? []).map((row) => orderItemRowSchema.parse(row));
}

export async function getOrderWithItems(db: Db, orderId: string): Promise<OrderWithItems | null> {
  const order = await getOrderById(db, orderId);
  if (!order) return null;
  const items = await getOrderItems(db, orderId);
  return { ...order, items };
}

export async function updateOrderStatus(
  db: Db,
  orderId: string,
  status: OrderStatus,
): Promise<Order | null> {
  const order = await getOrderById(db, orderId);
  if (!order) return null;

  const { data, error } = await db
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();
  if (error) throw new Error(`updateOrderStatus: ${error.message}`);

  // Reverse commission if order is cancelled after being paid
  if (status === "cancelled" && order.status !== "cancelled") {
    const { reverseCommissionOnRefund } = await import("./referral-rewards.js");
    await reverseCommissionOnRefund(db, orderId, "Order cancelled").catch((err) =>
      console.error(`Commission reversal failed for order ${orderId}:`, err),
    );
  }

  // Full-payment rule: split orders (deposit first, balance on delivery) earn
  // commission only once the balance is collected, i.e. at delivery — never
  // on the deposit. processReferralReward is idempotent (no-op when the
  // referral row is already qualified), so full-payment orders rewarded at
  // charge time are unaffected by this second call.
  if (status === "delivered" && order.status !== "delivered") {
    const { processReferralReward } = await import("./referral-rewards.js");
    const delivered = orderRowSchema.parse(data);
    await processReferralReward(db, {
      referredProfileId: delivered.profileId,
      orderId: delivered.id,
      orderTotalHalala: delivered.totalHalala,
    }).catch((err) =>
      console.error(`Delivery commission failed for order ${orderId}:`, err),
    );
  }

  return orderRowSchema.parse(data);
}

export async function updatePaymentStatus(
  db: Db,
  orderId: string,
  paymentStatus: PaymentStatus,
): Promise<Order | null> {
  const order = await getOrderById(db, orderId);
  if (!order) return null;
  const { data, error } = await db
    .from("orders")
    .update({ payment_status: paymentStatus })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .single();
  if (error) throw new Error(`updatePaymentStatus: ${error.message}`);
  return orderRowSchema.parse(data);
}

export interface AdminOrderFilters {
  status?: OrderStatus | null;
  page?: number;
  pageSize?: number;
}

export async function listOrders(db: Db, filters: AdminOrderFilters = {}): Promise<{
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db.from("orders").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw new Error(`listOrders: ${error.message}`);
  return {
    items: (data ?? []).map((row) => orderRowSchema.parse(row)),
    total: count ?? 0,
    page,
    pageSize,
  };
}
