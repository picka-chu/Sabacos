import { Hono } from "hono";
import { badRequest, safeParse } from "../errors.js";
import { addCartItemSchema, patchCartItemSchema, type CartSummary } from "@sabacos/core";
import { getAppEnv, type AppEnv } from "../env.js";
import type { UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getProductById } from "../db/catalog.js";
import {
  addToCart,
  clearCart,
  getCartSummary,
  patchCartItem,
  removeCartItem,
} from "../db/cart.js";

export const cartRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

cartRoutes.get("/", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const summary = await getCartSummary(db, profile.id);
  return c.json(summary);
});

cartRoutes.post("/", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const body = await c.req.json().catch(() => null);
  const input = safeParse(addCartItemSchema, body);

  const product = await getProductById(db, input.productId);
  if (!product || !product.isActive) throw badRequest("Product not available");
  const qty = Math.min(input.qty, Math.max(0, product.stock));
  if (qty < 1) throw badRequest("Product is out of stock");

  await addToCart(db, profile.id, product.id, qty);
  const summary = await getCartSummary(db, profile.id);
  return c.json(summary);
});

cartRoutes.patch("/:id", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const itemId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const input = safeParse(patchCartItemSchema, body);

  const summary = await getCartSummary(db, profile.id);
  const item = summary.items.find((i) => i.id === itemId);
  if (!item) throw badRequest("Cart item not found");

  const qty = Math.min(input.qty, Math.max(0, item.product.stock));
  if (qty < 1) {
    await removeCartItem(db, profile.id, itemId);
  } else {
    await patchCartItem(db, profile.id, itemId, qty);
  }
  const updated = await getCartSummary(db, profile.id);
  return c.json(updated);
});

cartRoutes.delete("/:id", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  await removeCartItem(db, profile.id, c.req.param("id"));
  const summary = await getCartSummary(db, profile.id);
  return c.json(summary);
});

cartRoutes.delete("/", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  await clearCart(db, profile.id);
  const summary = await getCartSummary(db, profile.id);
  return c.json(summary);
});