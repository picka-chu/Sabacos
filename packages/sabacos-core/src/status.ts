import type { OrderStatus, PaymentStatus } from "./types.js";

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["success", "failed", "refunded"],
  success: ["refunded"],
  failed: ["pending"],
  refunded: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalOrder(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled";
}

export function isPaidOrder(status: OrderStatus): boolean {
  return status === "paid" || status === "processing" || status === "shipped" || status === "delivered";
}

export function isCancelled(status: OrderStatus): boolean {
  return status === "cancelled";
}

export function nextOrderStatuses(from: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[from] ?? [];
}

export function defaultOrderStatus(): OrderStatus {
  return "pending_payment";
}

export function defaultPaymentStatus(): PaymentStatus {
  return "pending";
}