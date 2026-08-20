import { describe, expect, it } from "vitest";
import {
  toHalala,
  halalaToEtb,
  formatETB,
  formatETBCompact,
  clampQty,
  computeDeliveryFee,
  computeTotals,
  computeItemTotal,
} from "../src/index.js";

describe("money", () => {
  it("converts ETB to halala and back", () => {
    expect(toHalala(1250)).toBe(125000);
    expect(toHalala(0.5)).toBe(50);
    expect(halalaToEtb(125000)).toBe(1250);
    expect(halalaToEtb(50)).toBe(0.5);
  });

  it("formats ETB with two decimals", () => {
    expect(formatETB(125000)).toBe("ETB\u00a01,250.00");
    expect(formatETBCompact(125000)).toBe("ETB 1,250.00");
    expect(formatETB(0)).toBe("ETB\u00a00.00");
  });

  it("clamps quantity to 1..99", () => {
    expect(clampQty(0)).toBe(1);
    expect(clampQty(5)).toBe(5);
    expect(clampQty(500)).toBe(99);
    expect(clampQty(2.9)).toBe(2);
  });
});

describe("totals", () => {
  const fee = 12000;
  const threshold = 150000;

  it("charges delivery fee below threshold", () => {
    expect(computeDeliveryFee(100000, fee, threshold)).toBe(12000);
  });

  it("waives delivery fee at threshold", () => {
    expect(computeDeliveryFee(150000, fee, threshold)).toBe(0);
    expect(computeDeliveryFee(200000, fee, threshold)).toBe(0);
  });

  it("waives fee when threshold disabled", () => {
    expect(computeDeliveryFee(100000, fee, 0)).toBe(12000);
  });

  it("computes order totals", () => {
    const totals = computeTotals(
      [
        { priceHalala: 50000, qty: 2 },
        { priceHalala: 30000, qty: 1 },
      ],
      fee,
      threshold,
    );
    expect(totals.subtotalHalala).toBe(130000);
    expect(totals.deliveryFeeHalala).toBe(12000);
    expect(totals.totalHalala).toBe(142000);
  });

  it("computes item total", () => {
    expect(computeItemTotal({ priceHalala: 45000, qty: 3 })).toBe(135000);
  });
});