import {
  formatOrderNo,
  orderItemRowSchema,
  orderRowSchema,
  type Order,
  type OrderItem,
  type OrderStatus,
  type OrderWithItems,
  type PaymentStatus,
} from "@sabacos/core";
import type { Db } from "./client.js";
import { nextOrderSeq } from "./sequences.js";

export interface CreateOrderInput {
  profileId: string;
  subtotalHalala: number;
  deliveryFeeHalala: number;
  totalHalala: number;
  customerName: string;
  phone: string;
  address: string;
  note: string | null;
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
  const seq = await nextOrderSeq(db);
  const orderNo = formatOrderNo(seq);

  const { data, error } = await db
    .from("orders")
    .insert({
      order_no: orderNo,
      profile_id: input.profileId,
      status: "pending_payment",
      payment_status: "pending",
      subtotal_halala: input.subtotalHalala,
      delivery_fee_halala: input.deliveryFeeHalala,
      total_halala: input.totalHalala,
      customer_name: input.customerName,
      phone: input.phone,
      address: input.address,
      note: input.note ?? null,
      invoice_payload: "",
    })
    .select("*")
    .single();
  if (error) throw new Error(`createOrder: ${error.message}`);

  const order = orderRowSchema.parse(data);

  const itemRows = input.items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    name_en: item.nameEn,
    name_am: item.nameAm,
    sku: item.sku,
    price_halala: item.priceHalala,
    qty: item.qty,
    subtotal_halala: item.subtotalHalala,
  }));

  const { error: itemsError } = await db.from("order_items").insert(itemRows);
  if (itemsError) throw new Error(`createOrder items: ${itemsError.message}`);

  const { error: payloadError } = await db
    .from("orders")
    .update({ invoice_payload: order.id })
    .eq("id", order.id);
  if (payloadError) throw new Error(`createOrder payload: ${payloadError.message}`);

  return { ...order, invoicePayload: order.id };
}

export async function getOrderById(db: Db, id: string): Promise<Order | null> {
  const { data, error } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getOrderById: ${error.message}`);
  return data ? orderRowSchema.parse(data) : null;
}

export async function getOrdersByProfile(db: Db, profileId: string): Promise<Order[]> {
  const { data, error } = await db
    .from("orders")
    .select("*")
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
    .order("created_at", { ascending: false });
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
    .select("*")
    .single();
  if (error) throw new Error(`updateOrderStatus: ${error.message}`);
  return orderRowSchema.parse(data);
}

export async function updatePaymentStatus(
  db: Db,
  orderId: string,
  paymentStatus: PaymentStatus,
): Promise<Order | null> {
  const { data, error } = await db
    .from("orders")
    .update({ payment_status: paymentStatus })
    .eq("id", orderId)
    .select("*")
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