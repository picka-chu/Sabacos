import { Hono } from "hono";
import { z } from "zod";
import { badRequest, safeParse } from "../errors.js";
import { checkoutSchema } from "@sabacos/core";
import type { AppEnv } from "../env.js";
import type { UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getOrdersByProfile, getOrderWithItems } from "../db/orders.js";
import { saveProfileContact } from "../db/profiles.js";
import { checkout, CartValidationError } from "../services/checkout.js";
import { makeSendInvoice, createBot } from "../bot/bot.js";

export const orderRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

orderRoutes.post("/auth/telegram", (c) => c.json({ profile: c.get("profile") }));

const saveProfileSchema = z
  .object({
    phone: z.string().trim().min(3).max(30).optional(),
    address: z.string().trim().min(5).max(500).optional(),
  })
  .refine((v) => v.phone !== undefined || v.address !== undefined, {
    message: "phone or address required",
  });

orderRoutes.post("/checkout", async (c) => {
  const db = getDb(c.env);
  const profile = c.get("profile");
  if (!profile.telegramId) throw badRequest("Telegram chat not linked");

  const body = await c.req.json().catch(() => null);
  const input = safeParse(checkoutSchema, body);

  const bot = createBot(c.env);
  try {
    const result = await checkout(
      db,
      profile.id,
      profile.telegramId,
      { ...input, note: input.note ?? null },
      { sendInvoice: makeSendInvoice(c.env, bot) },
    );
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof CartValidationError) {
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
        400,
      );
    }
    throw err;
  }
});

orderRoutes.get("/orders", async (c) => {
  const db = getDb(c.env);
  const profile = c.get("profile");
  const orders = await getOrdersByProfile(db, profile.id);
  return c.json({ orders });
});

orderRoutes.get("/orders/:id", async (c) => {
  const db = getDb(c.env);
  const profile = c.get("profile");
  const order = await getOrderWithItems(db, c.req.param("id"));
  if (!order || order.profileId !== profile.id) {
    return c.json({ error: { code: "not_found", message: "Order not found" } }, 404);
  }
  return c.json({ order });
});

orderRoutes.patch("/profile", async (c) => {
  const db = getDb(c.env);
  const profile = c.get("profile");
  const body = await c.req.json().catch(() => null);
  const input = safeParse(saveProfileSchema, body);
  const updated = await saveProfileContact(db, profile.id, {
    phone: input.phone,
    address: input.address,
  });
  return c.json({ profile: updated });
});