import { Hono } from "hono";
import { z } from "zod";
import { badRequest, safeParse } from "../errors.js";
import { checkoutSchema } from "@sabacos/core";
import { getAppEnv, type AppEnv } from "../env.js";
import type { UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getOrdersByProfile, getOrderWithItems } from "../db/orders.js";
import { saveProfileContact, getProfileById } from "../db/profiles.js";
import { checkout, CartValidationError } from "../services/checkout.js";
import { createBot, makeCreateInvoiceLink, sendShareRequest } from "../bot/bot.js";

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
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  if (!profile.telegramId) throw badRequest("Telegram chat not linked");

  const body = await c.req.json().catch(() => null);
  const input = safeParse(checkoutSchema, body);

  // Fresh coords shared via the bot count when the client doesn't send its own.
  const freshProfile = await getProfileById(db, profile.id).catch(() => null);

  const bot = createBot(env);
  try {
    const result = await checkout(
      db,
      profile.id,
      {
        ...input,
        note: input.note ?? null,
        latitude: input.latitude ?? freshProfile?.lastLatitude ?? null,
        longitude: input.longitude ?? freshProfile?.lastLongitude ?? null,
      },
      { createInvoiceLink: makeCreateInvoiceLink(env, bot) },
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
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const orders = await getOrdersByProfile(db, profile.id);
  return c.json({ orders });
});

orderRoutes.get("/orders/:id", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const order = await getOrderWithItems(db, c.req.param("id"));
  if (!order || order.profileId !== profile.id) {
    return c.json({ error: { code: "not_found", message: "Order not found" } }, 404);
  }
  return c.json({ order });
});

orderRoutes.patch("/profile", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const body = await c.req.json().catch(() => null);
  const input = safeParse(saveProfileSchema, body);
  const updated = await saveProfileContact(db, profile.id, {
    phone: input.phone,
    address: input.address,
  });
  return c.json({ profile: updated });
});

// Poll target for the bot-mediated share flow: the mini app pings this until
// the bot has saved the shared phone/location.
orderRoutes.get("/profile", async (c) => {
  const db = getDb(getAppEnv());
  const fresh = await getProfileById(db, c.get("profile").id);
  if (!fresh) return c.json({ error: { code: "not_found", message: "Profile not found" } }, 404);
  return c.json({ profile: fresh });
});

orderRoutes.post("/profile/request-phone", async (c) => {
  const env = getAppEnv();
  const profile = c.get("profile");
  if (!profile.telegramId) throw badRequest("Telegram chat not linked");
  await sendShareRequest(env, profile.telegramId, "phone");
  return c.json({ ok: true });
});

orderRoutes.post("/profile/request-location", async (c) => {
  const env = getAppEnv();
  const profile = c.get("profile");
  if (!profile.telegramId) throw badRequest("Telegram chat not linked");
  await sendShareRequest(env, profile.telegramId, "location");
  return c.json({ ok: true });
});