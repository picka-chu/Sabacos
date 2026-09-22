import { describe, expect, it, vi, beforeEach } from "vitest";
import { CartValidationError } from "../src/services/checkout.js";

const {
  getSettingsMock,
  getCartMock,
  clearCartMock,
  createOrderMock,
  getActiveDiscountsMock,
  getTotalDiscountForProfileMock,
  getReferredDiscountPercentMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getCartMock: vi.fn(),
  clearCartMock: vi.fn(),
  createOrderMock: vi.fn(),
  getActiveDiscountsMock: vi.fn(),
  getTotalDiscountForProfileMock: vi.fn(),
  getReferredDiscountPercentMock: vi.fn(),
}));

vi.mock("../src/db/settings.js", () => ({ getSettings: getSettingsMock }));
vi.mock("../src/db/cart.js", () => ({ getCart: getCartMock, clearCart: clearCartMock }));
vi.mock("../src/db/orders.js", () => ({ createOrder: createOrderMock }));
vi.mock("../src/db/discounts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db/discounts.js")>()),
  getActiveDiscounts: getActiveDiscountsMock,
}));
vi.mock("../src/db/waitlist.js", () => ({ getTotalDiscountForProfile: getTotalDiscountForProfileMock }));
vi.mock("../src/db/referrals.js", () => ({ getReferredDiscountPercent: getReferredDiscountPercentMock }));

const { checkout } = await import("../src/services/checkout.js");

const settings = {
  deliveryFeeHalala: 12000,
  freeDeliveryThresholdHalala: 150000,
  shopNameEn: "Sabacos",
  shopNameAm: "ሳባኮስ",
  shopPhone: "+251900000000",
  adminChannelId: null,
};

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    categoryId: null,
    sku: "SB-TST-001",
    nameEn: "Test Serum",
    nameAm: "ቴስት ሴረም",
    descriptionEn: "",
    descriptionAm: "",
    priceHalala: 50000,
    compareAtHalala: null,
    stock: 10,
    imageUrls: [],
    isActive: true,
    isFeatured: false,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function cartItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000002",
    productId: "00000000-0000-0000-0000-000000000001",
    qty: 2,
    createdAt: "",
    updatedAt: "",
    product: product(),
    ...overrides,
  };
}

const createInvoiceLink = vi.fn();
const db = {} as never;
const input = {
  customerName: "Selam",
  phone: "+251911111111",
  address: "Bole, Addis Ababa",
  note: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSettingsMock.mockResolvedValue(settings);
  getActiveDiscountsMock.mockResolvedValue([]);
  getTotalDiscountForProfileMock.mockResolvedValue(0);
  getReferredDiscountPercentMock.mockResolvedValue(0);
  createOrderMock.mockImplementation(async (_db: never, o: { subtotalHalala: number; deliveryFeeHalala: number; totalHalala: number }) => ({
    id: "00000000-0000-0000-0000-000000000009",
    orderNo: "SB-000001",
    profileId: "p",
    status: "pending_payment",
    subtotalHalala: o.subtotalHalala,
    deliveryFeeHalala: o.deliveryFeeHalala,
    totalHalala: o.totalHalala,
    customerName: input.customerName,
    phone: input.phone,
    address: input.address,
    note: null,
    invoicePayload: "00000000-0000-0000-0000-000000000009",
    telegramPaymentChargeId: null,
    providerPaymentChargeId: null,
    paymentStatus: "pending",
    createdAt: "",
    updatedAt: "",
  }));
});

describe("checkout", () => {
  it("rejects an empty cart", async () => {
    getCartMock.mockResolvedValue([]);
    await expect(
      checkout(db, "profile-1", input, { createInvoiceLink }),
    ).rejects.toMatchObject({ code: "empty" });
    expect(createInvoiceLink).not.toHaveBeenCalled();
  });

  it("rejects inactive products", async () => {
    getCartMock.mockResolvedValue([cartItem({ product: product({ isActive: false }) })]);
    await expect(
      checkout(db, "profile-1", input, { createInvoiceLink }),
    ).rejects.toMatchObject({ code: "inactive" });
  });

  it("rejects quantities above stock", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 5, product: product({ stock: 3 }) })]);
    await expect(
      checkout(db, "profile-1", input, { createInvoiceLink }),
    ).rejects.toMatchObject({ code: "insufficient_stock" });
  });

  it("rejects orders below the minimum total", { timeout: 15_000 }, async () => {
    getCartMock.mockResolvedValue([
      cartItem({ qty: 1, product: product({ priceHalala: 100 }) }),
    ]);
    await expect(
      checkout(db, "profile-1", input, { createInvoiceLink }),
    ).rejects.toMatchObject({ code: "min_order" });
  });

  it("creates the order, initializes a invoice link, and clears the cart", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    createInvoiceLink.mockResolvedValue("https://t.me/invoice/abc123");

    const result = await checkout(db, "profile-1", input, { createInvoiceLink });

    // No coords/zone given → use the configured flat delivery fee.
    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        profileId: "profile-1",
        subtotalHalala: 100000,
        deliveryFeeHalala: 12000,
        totalHalala: 112000,
      }),
    );
    expect(createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: "00000000-0000-0000-0000-000000000009",
        title: "Sabacos — Order SB-000001",
        currency: "ETB",
        prices: [
          { label: "Test Serum × 2", amount: 100000 },
          { label: "Delivery fee", amount: 12000 },
        ],
      }),
    );
    expect(clearCartMock).toHaveBeenCalledWith(db, "profile-1");
    expect(result.invoiceUrl).toBe("https://t.me/invoice/abc123");
    expect(result.order.orderNo).toBe("SB-000001");
    expect(result.delivery.zone).toBeNull();
  });

  it("prices express delivery with the zone surcharge", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    createInvoiceLink.mockResolvedValue("https://t.me/invoice/express");

    await checkout(
      db,
      "profile-1",
      { ...input, zone: 1, deliveryType: "express" },
      { createInvoiceLink },
    );

    // (5500 base + 0 zone surcharge) × 1.5 = 8250
    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ deliveryFeeHalala: 8250, totalHalala: 108250 }),
    );
    expect(createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: [
          { label: "Test Serum × 2", amount: 100000 },
          { label: "Delivery", amount: 5500 },
          { label: "Express surcharge", amount: 2750 },
        ],
      }),
    );
  });

  it("adds the fragile handling fee", async () => {
    getCartMock.mockResolvedValue([
      cartItem({ qty: 1, product: product({ priceHalala: 30000, isFragile: true }) }),
    ]);
    createInvoiceLink.mockResolvedValue("https://t.me/invoice/fragile");

    await checkout(db, "profile-1", input, { createInvoiceLink });

    // subtotal 30000 → configured flat fee + fragile handling fee
    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        fragile: true,
        deliveryFeeHalala: 13000,
        totalHalala: 43000,
      }),
    );
    expect(createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: expect.arrayContaining([{ label: "Fragile handling", amount: 1000 }]),
      }),
    );
  });

  it("waives the delivery fee above the free threshold", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 5, product: product({ priceHalala: 40000 }) })]);
    createInvoiceLink.mockResolvedValue("https://t.me/invoice/freedelivery");

    await checkout(db, "profile-1", input, { createInvoiceLink });

    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        subtotalHalala: 200000,
        deliveryFeeHalala: 0,
        totalHalala: 200000,
      }),
    );
    expect(createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: [{ label: "Test Serum × 5", amount: 200000 }],
      }),
    );
  });

  it("keeps the cart when invoice creation fails", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    createInvoiceLink.mockRejectedValue(new Error("invoice failed"));

    await expect(
      checkout(db, "profile-1", input, { createInvoiceLink }),
    ).rejects.toMatchObject({ code: "min_order", message: "Could not create payment link. Please try again." });
    expect(clearCartMock).not.toHaveBeenCalled();
  });

  it("applies the referred-friend discount automatically with no coupon code", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    getReferredDiscountPercentMock.mockResolvedValue(5);
    createInvoiceLink.mockResolvedValue("https://t.me/invoice/referred");

    await checkout(db, "profile-1", input, { createInvoiceLink });

    // subtotal 100000 → 5% = 5000 referred discount, + 12000 delivery
    expect(getReferredDiscountPercentMock).toHaveBeenCalledWith(db, "profile-1", 100000);
    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        discountHalala: 5000,
        discountPercent: 5,
        totalHalala: 107000,
      }),
    );
    expect(createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({
        prices: expect.arrayContaining([
          { label: "Referral discount (5%)", amount: -5000 },
        ]),
      }),
    );
  });

  it("prefers the referred discount over the waitlist discount (no stacking)", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    getReferredDiscountPercentMock.mockResolvedValue(5);
    getTotalDiscountForProfileMock.mockResolvedValue(10);
    createInvoiceLink.mockResolvedValue("https://t.me/invoice/referred-first");

    await checkout(db, "profile-1", input, { createInvoiceLink });

    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ discountHalala: 5000, discountPercent: 5 }),
    );
  });

  it("skips the referred discount when a promotion already applies", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    getReferredDiscountPercentMock.mockResolvedValue(5);
    getActiveDiscountsMock.mockResolvedValue([
      {
        id: "d1", name: "Sale", description: "", discountType: "percent",
        discountValue: 10, scope: "all", categoryId: null, productIds: [],
        minSubtotalHalala: null, startsAt: null, endsAt: null,
        isActive: true, createdAt: "", updatedAt: "",
      },
    ]);
    createInvoiceLink.mockResolvedValue("https://t.me/invoice/promo");

    await checkout(db, "profile-1", input, { createInvoiceLink });

    // 10% promo = 10000 off; referred 5% must NOT stack on top.
    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ discountHalala: 10000, discountPercent: 0 }),
    );
    expect(getReferredDiscountPercentMock).not.toHaveBeenCalled();
  });
});

describe("CartValidationError", () => {
  it("carries code and fields", () => {
    const err = new CartValidationError("nope", "insufficient_stock", { pid: "Only 2 available" });
    expect(err.code).toBe("insufficient_stock");
    expect(err.fields).toEqual({ pid: "Only 2 available" });
    expect(err).toBeInstanceOf(Error);
  });
});
