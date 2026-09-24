import { describe, expect, it } from "vitest";
import { referralSettingsRowSchema, uuidSchema } from "../src/index.js";

const SENTINEL_ID = "00000000-0000-0000-0000-000000000001";

const baseRow = {
  id: SENTINEL_ID,
  is_active: true,
  first_purchase_percent: 10,
  repeat_purchase_percent: 0,
  referred_discount_percent: 5,
  affiliate_percent: 10,
  monthly_cap_halala: 800000,
  referrals_per_spin: 3,
  max_spins_per_week: 5,
  spin_expiry_days: 30,
  coupon_expiry_days: 14,
  max_coupons_per_order: 1,
  min_account_age_days: 30,
  min_order_value_halala: 10000,
  reward_budget_pct: 15,
  top_prize_cost_halala: 50000,
  adaptive_enabled: false,
  last_adjustment_date: null,
  adjustment_day_of_week: 1,
  daily_spend_cap_halala: 0,
  daily_spend_cap_enabled: false,
  guardrail_commission_min: 3,
  guardrail_commission_max: 10,
  guardrail_spin_cap_min: 1,
  guardrail_spin_cap_max: 5,
  guardrail_prize_cost_min: 30000,
  guardrail_prize_cost_max: 150000,
  guardrail_max_budget_pct: 25,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("uuidSchema (postgres-style)", () => {
  it("accepts the referral_settings sentinel id", () => {
    expect(uuidSchema.safeParse(SENTINEL_ID).success).toBe(true);
  });

  it("accepts a normal v4 uuid", () => {
    expect(uuidSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
  });

  it("rejects non-uuid strings", () => {
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("referralSettingsRowSchema", () => {
  it("parses the singleton row with the sentinel id", () => {
    const result = referralSettingsRowSchema.safeParse(baseRow);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe(SENTINEL_ID);
    expect(result.data.firstPurchasePercent).toBe(10);
    expect(result.data.affiliatePercent).toBe(10);
    expect(result.data.referredDiscountPercent).toBe(5);
  });

  it("defaults optional columns when the DB has not run later migrations", () => {
    const minimal = {
      id: SENTINEL_ID,
      is_active: false,
      first_purchase_percent: 5,
      repeat_purchase_percent: 0,
      monthly_cap_halala: 500000,
      referrals_per_spin: 3,
      max_spins_per_week: 5,
      spin_expiry_days: 30,
      coupon_expiry_days: 14,
      max_coupons_per_order: 1,
      min_account_age_days: 30,
      min_order_value_halala: 10000,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const result = referralSettingsRowSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.referredDiscountPercent).toBe(5);
    expect(result.data.affiliatePercent).toBe(10);
  });
});
