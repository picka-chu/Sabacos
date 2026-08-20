import { DEFAULT_DELIVERY_FEE_HALALA, ORDER_PREFIX, type OrderTotals } from "./types.js";

export function formatOrderNo(seq: number): string {
  return `${ORDER_PREFIX}-${String(seq).padStart(6, "0")}`;
}

export function parseOrderSeq(orderNo: string): number {
  const match = orderNo.match(/^SB-(\d+)$/);
  return match ? Number(match[1]) : NaN;
}

export function computeDeliveryFee(
  subtotalHalala: number,
  deliveryFeeHalala: number,
  freeDeliveryThresholdHalala: number,
): number {
  if (freeDeliveryThresholdHalala > 0 && subtotalHalala >= freeDeliveryThresholdHalala) {
    return 0;
  }
  return deliveryFeeHalala;
}

export function computeTotals(
  lines: Array<{ priceHalala: number; qty: number }>,
  deliveryFeeHalala: number,
  freeDeliveryThresholdHalala: number,
): OrderTotals {
  const subtotalHalala = lines.reduce(
    (sum, line) => sum + line.priceHalala * line.qty,
    0,
  );
  const fee = computeDeliveryFee(
    subtotalHalala,
    deliveryFeeHalala,
    freeDeliveryThresholdHalala,
  );
  return {
    subtotalHalala,
    deliveryFeeHalala: fee,
    totalHalala: subtotalHalala + fee,
  };
}

export function computeItemTotal(line: { priceHalala: number; qty: number }): number {
  return line.priceHalala * line.qty;
}

export { DEFAULT_DELIVERY_FEE_HALALA };