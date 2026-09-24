import { describe, expect, it, vi } from "vitest";
import { countPendingReferrals, countQualifiedReferrals } from "../src/db/referrals.js";

function countDb(count: number | null) {
  const chain: Record<string, unknown> = { count, error: null };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  return { from: vi.fn(() => chain), __chain: chain };
}

describe("referral counters", () => {
  it("countPendingReferrals counts status=pending rows for the referrer", async () => {
    const db = countDb(2);
    const n = await countPendingReferrals(db as never, "referrer-id");
    expect(n).toBe(2);
    expect(db.from).toHaveBeenCalledWith("referrals");
    const eq = (db.__chain.eq as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(eq).toContainEqual(["referrer_id", "referrer-id"]);
    expect(eq).toContainEqual(["status", "pending"]);
  });

  it("countQualifiedReferrals still counts status=qualified rows", async () => {
    const db = countDb(5);
    const n = await countQualifiedReferrals(db as never, "referrer-id");
    expect(n).toBe(5);
    const eq = (db.__chain.eq as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(eq).toContainEqual(["status", "qualified"]);
  });

  it("returns 0 when the count is null", async () => {
    const db = countDb(null);
    expect(await countPendingReferrals(db as never, "referrer-id")).toBe(0);
  });
});
