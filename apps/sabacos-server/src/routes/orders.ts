import { Hono } from "hono";
import { z } from "zod";
import { badRequest, safeParse } from "../errors.js";
import { checkoutSchema } from "@sabacos/core";
import { getAppEnv, type AppEnv } from "../env.js";
import { requireUser, type UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getOrdersByProfile, getOrderWithItems, getOrderById } from "../db/orders.js";
import { saveProfileContact, getProfileById, setProfileLanguage } from "../db/profiles.js";
import { submitPaymentProof } from "../db/bank-accounts.js";
import { checkout, CartValidationError } from "../services/checkout.js";
import { createBot, makeCreateInvoiceLink, notifyAdminChannelWithButtons, sendShareRequest, formatAdminOrderAlert } from "../bot/bot.js";
import { r2Config, r2Put } from "../services/r2.js";

export const orderRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

// Apply auth middleware to all routes in this sub-router so that context
// variables (profile) are guaranteed to be set in the same Hono context.
orderRoutes.use("*", requireUser);

orderRoutes.post("/auth/telegram", (c) => c.json({ profile: c.get("profile") }));

const saveProfileSchema = z
  .object({
    phone: z.string().trim().min(3).max(30).optional(),
    address: z.string().trim().min(5).max(500).optional(),
    language: z.enum(["en", "am"]).optional(),
  })
  .refine((v) => v.phone !== undefined || v.address !== undefined || v.language !== undefined, {
    message: "phone, address or language required",
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
    // Use the profile's saved phone for Chapa invoices — must match the
    // phone the user enters in the Telegram payment dialog for security.
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
      freshProfile?.phone ?? profile.phone ?? undefined,
    );

    // Wallet and COD payments are finalized server-side and need the admin alert.
    if (!result.invoiceUrl) {
      const order = await getOrderWithItems(db, result.order.id).catch(() => null);
      if (order) {
        await notifyAdminChannelWithButtons(env, formatAdminOrderAlert(order), order.id).catch(() => undefined);
      }
    }

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
  let updated = profile;
  if (input.phone !== undefined || input.address !== undefined) {
    updated = await saveProfileContact(db, profile.id, {
      phone: input.phone,
      address: input.address,
    });
  }
  if (input.language) {
    updated = await setProfileLanguage(db, profile.id, input.language);
  }
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

const ALLOWED_RECEIPT_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

// Upload payment receipt for a bank_split order
orderRoutes.post("/orders/:id/payment-proof", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  const orderId = c.req.param("id");

  const order = await getOrderById(db, orderId);
  if (!order || order.profileId !== profile.id) {
    return c.json({ error: { code: "not_found", message: "Order not found" } }, 404);
  }
  if (order.paymentMethod !== "bank_split") {
    return c.json({ error: { code: "invalid_method", message: "This order is not a bank split payment" } }, 400);
  }
  if (order.paymentProofStatus === "approved") {
    return c.json({ error: { code: "already_verified", message: "Payment already approved" } }, 400);
  }

  const form = await c.req.parseBody();
  const file = form["receipt"];
  if (!(file instanceof File)) throw badRequest("receipt image required");
  if (file.size > MAX_RECEIPT_BYTES) throw badRequest("Image too large (max 10MB)");
  if (file.type && !ALLOWED_RECEIPT_MIMES.has(file.type)) {
    throw badRequest(`Unsupported image type: ${file.type}`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "receipt.jpg";
  const path = `proofs/${orderId}/${Date.now()}-${safeName}`;

  // Upload to R2 or Supabase Storage
  const r2 = r2Config(env);
  let proofUrl: string;
  if (r2) {
    try {
      proofUrl = await r2Put(r2, path, new Uint8Array(bytes), mime);
    } catch (err) {
      console.error("[r2] receipt upload failed, falling back to Supabase:", err);
      const { error } = await db.storage
        .from("product-images")
        .upload(path, new File([bytes], safeName, { type: mime }), { contentType: mime, upsert: true });
      if (error) throw new Error(`upload receipt: ${error.message}`);
      const { data } = db.storage.from("product-images").getPublicUrl(path);
      proofUrl = data.publicUrl;
    }
  } else {
    const { error } = await db.storage
      .from("product-images")
      .upload(path, new File([bytes], safeName, { type: mime }), { contentType: mime, upsert: true });
    if (error) throw new Error(`upload receipt: ${error.message}`);
    const { data } = db.storage.from("product-images").getPublicUrl(path);
    proofUrl = data.publicUrl;
  }

  await submitPaymentProof(db, orderId, proofUrl);

  // Notify admin channel with approve/reject buttons
  const deposit = order.depositHalala ?? Math.round(order.totalHalala / 2);
  const bankLabel = order.bankAccountId ? `Bank: ${order.bankAccountId.slice(0, 8)}...` : "";
  const alertText = [
    `💰 <b>Payment Receipt — Order ${order.orderNo}</b>`,
    `Customer: ${order.customerName}`,
    `Deposit: ${deposit} ETB`,
    bankLabel,
    `<a href="${proofUrl}">View Receipt</a>`,
  ].filter(Boolean).join("\n");

  const bot = createBot(env);
  const settings = await import("../db/settings.js").then((m) => m.getSettings(db)).catch(() => null);
  const channelId = (settings?.adminChannelId ?? env.ADMIN_CHANNEL_ID) ?? "";
  if (channelId) {
    await bot.api.sendMessage(channelId, alertText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `proof:${orderId}:approved` },
            { text: "❌ Reject", callback_data: `proof:${orderId}:rejected` },
          ],
        ],
      },
    }).catch((err: unknown) => console.error(`admin notify (receipt) failed:`, err));
  }

  return c.json({ ok: true, proofUrl });
});