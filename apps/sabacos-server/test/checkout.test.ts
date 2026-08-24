import { describe, expect, it, vi, beforeEach } from "vitest";
import { CartValidationError } from "../src/services/checkout.js";

const { getSettingsMock, getCartMock, clearCartMock, createOrderMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getCartMock: vi.fn(),
  clearCartMock: vi.fn(),
  createOrderMock: vi.fn(),
}));

vi.mock("../src/db/settings.js", () => ({ getSettings: getSettingsMock }));
vi.mock("../src/db/cart.js", () => ({ getCart: getCartMock, clearCart: clearCartMock }));
vi.mock("../src/db/orders.js", () => ({ createOrder: createOrderMock }));

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

  it("rejects orders below the minimum total", async () => {
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

    // No coords/zone given → default Zone 2 surcharge (2500) + base tier (5500).
    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        profileId: "profile-1",
        subtotalHalala: 100000,
        deliveryFeeHalala: 8000,
        totalHalala: 108000,
      }),
    );
    expect(createInvoiceLink).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: "00000000-0000-0000-0000-000000000009",
        title: "Sabacos — Order SB-000001",
        currency: "ETB",
        prices: [
          { label: "Test Serum × 2", amount: 100000 },
          { label: "Delivery fee", amount: 8000 },
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

    // subtotal 30000 → base 9000 + zone 2500 + fragile 1000
    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        fragile: true,
        deliveryFeeHalala: 12500,
        totalHalala: 42500,
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

  it("propagates Chapa failures and and clears the cart", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    createInvoiceLink.mockRejectedValue(new Error("invoice failed"));

    await expect(
      checkout(db, "profile-1", input, { createInvoiceLink }),
    ).rejects.toThrow("invoice failed");
    expect(clearCartMock).toHaveBeenCalledWith(db, "profile-1");
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
