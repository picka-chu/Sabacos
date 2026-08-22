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

const initializeTransaction = vi.fn();
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
      checkout(db, "profile-1", input, { initializeTransaction }),
    ).rejects.toMatchObject({ code: "empty" });
    expect(initializeTransaction).not.toHaveBeenCalled();
  });

  it("rejects inactive products", async () => {
    getCartMock.mockResolvedValue([cartItem({ product: product({ isActive: false }) })]);
    await expect(
      checkout(db, "profile-1", input, { initializeTransaction }),
    ).rejects.toMatchObject({ code: "inactive" });
  });

  it("rejects quantities above stock", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 5, product: product({ stock: 3 }) })]);
    await expect(
      checkout(db, "profile-1", input, { initializeTransaction }),
    ).rejects.toMatchObject({ code: "insufficient_stock" });
  });

  it("rejects orders below the minimum total", async () => {
    getCartMock.mockResolvedValue([
      cartItem({ qty: 1, product: product({ priceHalala: 100 }) }),
    ]);
    await expect(
      checkout(db, "profile-1", input, { initializeTransaction }),
    ).rejects.toMatchObject({ code: "min_order" });
  });

  it("creates the order, initializes a Chapa transaction, and clears the cart", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    initializeTransaction.mockResolvedValue("https://checkout.chapa.pay/abc123");

    const result = await checkout(db, "profile-1", input, { initializeTransaction });

    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        profileId: "profile-1",
        subtotalHalala: 100000,
        deliveryFeeHalala: 12000,
        totalHalala: 112000,
      }),
    );
    expect(initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        txRef: "00000000-0000-0000-0000-000000000009",
        amountHalala: 112000,
        orderId: "00000000-0000-0000-0000-000000000009",
        orderNo: "SB-000001",
        shopName: "Sabacos",
        phone: "+251911111111",
      }),
    );
    expect(clearCartMock).toHaveBeenCalledWith(db, "profile-1");
    expect(result.checkoutUrl).toBe("https://checkout.chapa.pay/abc123");
    expect(result.order.orderNo).toBe("SB-000001");
  });

  it("waives the delivery fee above the free threshold", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 5, product: product({ priceHalala: 40000 }) })]);
    initializeTransaction.mockResolvedValue("https://checkout.chapa.pay/free-delivery");

    await checkout(db, "profile-1", input, { initializeTransaction });

    expect(createOrderMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        subtotalHalala: 200000,
        deliveryFeeHalala: 0,
        totalHalala: 200000,
      }),
    );
    expect(initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ amountHalala: 200000 }),
    );
  });

  it("propagates Chapa failures and still clears the cart", async () => {
    getCartMock.mockResolvedValue([cartItem({ qty: 2 })]);
    initializeTransaction.mockRejectedValue(new Error("chapa down"));

    await expect(
      checkout(db, "profile-1", input, { initializeTransaction }),
    ).rejects.toThrow("chapa down");
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
