import { describe, expect, it } from "vitest";
import {
  payoutWeekday,
  payoutWeekdayName,
  startOfWeekUtc,
  WITHDRAWAL_THRESHOLD_HALALA,
  WITHDRAWAL_AGE_DAYS,
} from "../src/db/referral-rewards.js";

describe("payout weekday", () => {
  it("derives the weekday from account creation time (UTC, matches SQL DOW)", () => {
    // 2026-09-23 is a Wednesday.
    expect(payoutWeekday("2026-09-23T10:00:00Z")).toBe(3);
    expect(payoutWeekdayName("2026-09-23T10:00:00Z")).toBe("Wednesday");
    // Sunday edge.
    expect(payoutWeekday("2026-09-27T00:00:00Z")).toBe(0);
    expect(payoutWeekdayName("2026-09-27T00:00:00Z")).toBe("Sunday");
  });

  it("spreads referrers across the week deterministically", () => {
    expect(payoutWeekday("2026-09-23T10:00:00Z")).not.toBe(payoutWeekday("2026-09-24T10:00:00Z"));
  });

  it("computes Monday 00:00 UTC week start", () => {
    // Wednesday 2026-09-23 → Monday 2026-09-21.
    expect(startOfWeekUtc(new Date("2026-09-23T15:00:00Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
    // Sunday 2026-09-27 → Monday 2026-09-21 (same week).
    expect(startOfWeekUtc(new Date("2026-09-27T23:00:00Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
    // Monday stays.
    expect(startOfWeekUtc(new Date("2026-09-21T00:00:01Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });

  it("pins the business constants", () => {
    expect(WITHDRAWAL_THRESHOLD_HALALA).toBe(50_000); // 500 ETB
    expect(WITHDRAWAL_AGE_DAYS).toBe(7);
  });
});
