import { describe, expect, it } from "vitest";
import { describeWriteAction, writeArgSchemas } from "../src/services/ai-agent.js";

describe("ai-agent write schemas", () => {
  it("accepts a valid discount proposal in ETB", () => {
    const parsed = writeArgSchemas.create_discount.safeParse({
      name: "Payday 15%",
      discountType: "percent",
      discountValue: 15,
      scope: "all",
      durationDays: 7,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects bad button combos for broadcast", () => {
    expect(
      writeArgSchemas.send_broadcast.safeParse({ text: "hi", buttonInline: true }).success,
    ).toBe(false);
    expect(
      writeArgSchemas.send_broadcast.safeParse({
        text: "hi",
        buttonText: "Shop",
        buttonInline: true,
        buttonTarget: "/shop",
      }).success,
    ).toBe(true);
    expect(
      writeArgSchemas.send_broadcast.safeParse({ text: "hi", buttonUrl: "https://x.com" }).success,
    ).toBe(false);
  });

  it("requires at least one field for product updates", () => {
    expect(writeArgSchemas.update_product.safeParse({ id: "abc" }).success).toBe(false);
    expect(
      writeArgSchemas.update_product.safeParse({ id: "abc", stock: 10 }).success,
    ).toBe(true);
  });

  it("rejects unknown action params loudly", () => {
    expect(
      writeArgSchemas.create_discount.safeParse({
        name: "x",
        discountType: "percent",
        discountValue: 10,
        scope: "all",
        commissionPct: 99,
      }).success,
    ).toBe(false);
  });
});

describe("describeWriteAction", () => {
  it("summarizes without hallucinating numbers", () => {
    expect(
      describeWriteAction("create_discount", {
        name: "Payday",
        discountType: "percent",
        discountValue: 15,
        scope: "all",
        durationDays: 7,
      }),
    ).toBe('Create 15% discount "Payday" (all scope, ~7 days)');
    expect(describeWriteAction("post_to_channel", { productId: "p1" })).toContain("p1");
  });
});
