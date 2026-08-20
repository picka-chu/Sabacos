import { describe, expect, it } from "vitest";
import {
  canTransitionOrder,
  canTransitionPayment,
  isTerminalOrder,
  isPaidOrder,
  nextOrderStatuses,
  defaultOrderStatus,
  defaultPaymentStatus,
} from "../src/index.js";

describe("order status machine", () => {
  it("starts at pending_payment", () => {
    expect(defaultOrderStatus()).toBe("pending_payment");
    expect(defaultPaymentStatus()).toBe("pending");
  });

  it("allows valid transitions", () => {
    expect(canTransitionOrder("pending_payment", "paid")).toBe(true);
    expect(canTransitionOrder("pending_payment", "cancelled")).toBe(true);
    expect(canTransitionOrder("paid", "processing")).toBe(true);
    expect(canTransitionOrder("processing", "shipped")).toBe(true);
    expect(canTransitionOrder("shipped", "delivered")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionOrder("pending_payment", "shipped")).toBe(false);
    expect(canTransitionOrder("delivered", "shipped")).toBe(false);
    expect(canTransitionOrder("cancelled", "paid")).toBe(false);
  });

  it("knows terminal and paid states", () => {
    expect(isTerminalOrder("delivered")).toBe(true);
    expect(isTerminalOrder("cancelled")).toBe(true);
    expect(isTerminalOrder("paid")).toBe(false);
    expect(isPaidOrder("paid")).toBe(true);
    expect(isPaidOrder("processing")).toBe(true);
    expect(isPaidOrder("pending_payment")).toBe(false);
  });

  it("lists next statuses", () => {
    expect(nextOrderStatuses("pending_payment")).toEqual(["paid", "cancelled"]);
    expect(nextOrderStatuses("delivered")).toEqual([]);
  });

  it("handles payment transitions", () => {
    expect(canTransitionPayment("pending", "success")).toBe(true);
    expect(canTransitionPayment("pending", "failed")).toBe(true);
    expect(canTransitionPayment("success", "refunded")).toBe(true);
    expect(canTransitionPayment("failed", "success")).toBe(false);
    expect(canTransitionPayment("refunded", "pending")).toBe(false);
  });
});