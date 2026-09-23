import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  getReferralSettingsMock,
  getReferralByReferredIdMock,
  rpcMock,
} = vi.hoisted(() => ({
  getReferralSettingsMock: vi.fn(),
  getReferralByReferredIdMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../src/db/referrals.js", () => ({
  getReferralById: vi.fn(),
  getReferralSettings: getReferralSettingsMock,
  qualifyReferral: vi.fn(),
  getReferralByReferredId: getReferralByReferredIdMock,
}));

const { processAttributedCommission } = await import("../src/db/referral-rewards.js");

function tableStub(res: { data?: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({ data: res.data ?? null, error: null }));
  chain.maybeSingle = vi.fn(async () => ({ data: res.data ?? null, error: null }));
  chain.data = res.data ?? null;
  chain.count = res.count ?? null;
  chain.error = null;
  return chain;
}

const SETTINGS = {
  isActive: true,
  dailySpendCapEnabled: false,
  minOrderValueHalala: 10000,
  affiliatePercent: 10,
};

const ORDER = { id: "order-1", status: "paid", created_at: "2026-09-20T10:00:00Z" };

function dbWith(overrides: {
  rewardsCount?: number;
  attributedOrders?: Array<{ profile_id: string }>;
  buyerCreatedAt?: string;
}) {
  // The orders table is queried twice: via maybeSingle (status guard) and as
  // a list (buyer-cluster check) — serve each shape correctly.
  const ordersChain = tableStub({ data: null });
  ordersChain.maybeSingle = vi.fn(async () => ({ data: ORDER, error: null }));
  ordersChain.data = overrides.attributedOrders ?? [{ profile_id: "b1" }, { profile_id: "b2" }];

  const tables: Record<string, unknown> = {
    orders: ordersChain,
    order_items: tableStub({ data: [{ product_id: "p1", subtotal_halala: 100000 }] }),
    products: tableStub({ data: [{ id: "p1", commission_eligible: true }] }),
    referral_rewards: tableStub({ count: overrides.rewardsCount ?? 0 }),
    profiles: tableStub({
      data: { created_at: overrides.buyerCreatedAt ?? "2026-01-01T00:00:00Z" },
    }),
  };
  return {
    from: vi.fn((table: string) => tables[table]),
    rpc: rpcMock,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getReferralSettingsMock.mockResolvedValue(SETTINGS);
  getReferralByReferredIdMock.mockResolvedValue({
    status: "qualified",
    orderId: "older-order",
  });
  rpcMock.mockResolvedValue({
    data: { status: "credited", credited_halala: 10000, flagged: false },
    error: null,
  });
});

describe("processAttributedCommission", () => {
  it("skips when Track 1 owns the order (pending referral)", async () => {
    getReferralByReferredIdMock.mockResolvedValue({ status: "pending", orderId: null });
    const res = await processAttributedCommission(dbWith({}), {
      orderId: "order-1",
      sharerProfileId: "sharer",
      buyerProfileId: "buyer",
      orderTotalHalala: 100000,
    });
    expect(res).toMatchObject({ success: false, error: "track1_owns_order" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("skips when Track 1 just qualified this same order", async () => {
    getReferralByReferredIdMock.mockResolvedValue({ status: "qualified", orderId: "order-1" });
    const res = await processAttributedCommission(dbWith({}), {
      orderId: "order-1",
      sharerProfileId: "sharer",
      buyerProfileId: "buyer",
      orderTotalHalala: 100000,
    });
    expect(res).toMatchObject({ success: false, error: "track1_owns_order" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("credits via RPC with null referral and direct referrer otherwise", async () => {
    const res = await processAttributedCommission(dbWith({}), {
      orderId: "order-1",
      sharerProfileId: "sharer",
      buyerProfileId: "buyer",
      orderTotalHalala: 100000,
    });
    expect(res).toMatchObject({ success: true, commissionHalala: 10000, flaggedForReview: false });
    expect(rpcMock).toHaveBeenCalledWith("credit_referral_commission", {
      p_referral_id: null,
      p_order_id: "order-1",
      p_raw_commission_halala: 10000,
      p_referrer_id: "sharer",
      p_flag_reason: null,
    });
  });

  it("soft-flags velocity spikes but still credits", async () => {
    const res = await processAttributedCommission(dbWith({ rewardsCount: 12 }), {
      orderId: "order-1",
      sharerProfileId: "sharer",
      buyerProfileId: "buyer",
      orderTotalHalala: 100000,
    });
    expect(res.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "credit_referral_commission",
      expect.objectContaining({ p_flag_reason: expect.stringContaining("velocity_spike") }),
    );
  });

  it("rejects missing/self attribution without touching the DB", async () => {
    const db = dbWith({});
    const res = await processAttributedCommission(db, {
      orderId: "order-1",
      sharerProfileId: "buyer",
      buyerProfileId: "buyer",
      orderTotalHalala: 100000,
    });
    expect(res).toMatchObject({ success: false, error: "no_attribution" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
