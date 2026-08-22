import type { CartSummary, Order, OrderWithItems, Product, Profile } from "@sabacos/core";
import { create } from "zustand";
import { api, ApiError } from "./api.js";

interface ShopState {
  profile: Profile | null;
  profileStatus: "loading" | "ready" | "error";
  cart: CartSummary;
  cartLoading: boolean;
  setProfile: (profile: Profile) => void;
  setProfileStatus: (status: "loading" | "ready" | "error") => void;
  refreshCart: () => Promise<CartSummary>;
  addToCart: (product: Product, qty?: number) => Promise<CartSummary>;
  updateQty: (itemId: string, qty: number) => Promise<CartSummary>;
  removeItem: (itemId: string) => Promise<CartSummary>;
  clearCart: () => Promise<void>;
  checkout: (input: { customerName: string; phone: string; address: string; note?: string | null }) => Promise<{
    order: Order;
    invoiceUrl: string;
  }>;
  getOrder: (id: string) => Promise<OrderWithItems | null>;
  updateProfile: (input: { phone?: string; address?: string }) => Promise<Profile>;
  reset: () => void;
}

export const useShopStore = create<ShopState>((set, get) => ({
  profile: null,
  profileStatus: "loading",
  cart: { items: [], itemCount: 0, totals: { subtotalHalala: 0, deliveryFeeHalala: 0, totalHalala: 0 }, deliveryFeeHalala: 0, freeDeliveryThresholdHalala: 0 },
  cartLoading: false,

  setProfile: (profile) => set({ profile, profileStatus: "ready" }),

  setProfileStatus: (profileStatus) => set({ profileStatus }),

  refreshCart: async () => {
    set({ cartLoading: true });
    try {
      const cart = await api.get<CartSummary>("/cart");
      set({ cart, cartLoading: false });
      return cart;
    } catch (err) {
      set({ cartLoading: false });
      throw err;
    }
  },

  addToCart: async (product, qty = 1) => {
    const cart = await api.post<CartSummary>("/cart", { productId: product.id, qty });
    set({ cart });
    return cart;
  },

  updateQty: async (itemId, qty) => {
    const cart = await api.patch<CartSummary>(`/cart/${itemId}`, { qty });
    set({ cart });
    return cart;
  },

  removeItem: async (itemId) => {
    const cart = await api.del<CartSummary>(`/cart/${itemId}`);
    set({ cart });
    return cart;
  },

  clearCart: async () => {
    const cart = await api.del<CartSummary>("/cart");
    set({ cart });
  },

  checkout: async (input) => {
    const res = await api.post<{ order: Order; invoiceUrl: string }>("/checkout", input);
    return res;
  },

  getOrder: async (id) => {
    const res = await api.get<{ order: OrderWithItems }>(`/orders/${id}`);
    return res.order;
  },

  updateProfile: async (input) => {
    const res = await api.patch<{ profile: Profile }>("/profile", input);
    set({ profile: res.profile });
    return res.profile;
  },

  reset: () =>
    set({
      profile: null,
      cart: { items: [], itemCount: 0, totals: { subtotalHalala: 0, deliveryFeeHalala: 0, totalHalala: 0 }, deliveryFeeHalala: 0, freeDeliveryThresholdHalala: 0 },
    }),
}));

export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong";
}