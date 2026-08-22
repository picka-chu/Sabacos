import { Hono } from "hono";
import { formatETB, type OrderWithItems } from "@sabacos/core";
import type { AppEnv } from "../env.js";
import { getAppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import { getOrderWithItems } from "../db/orders.js";
import { getProfileById } from "../db/profiles.js";
import { verifyChapaSignature, verifyTransaction } from "../services/chapa.js";
import { createBot, formatAdminOrderAlert, notifyAdminChannel } from "../bot/bot.js";

export const webhookRoutes = new Hono<{ Bindings: AppEnv }>();

webhookRoutes.post("/chapa", async (c) => {
  const env = getAppEnv();
  const raw = await c.req.text();
  if (!verifyChapaSignature(raw, c.req.header("x-chapa-signature"))) {
    return c.json({ error: "bad signature" }, 401);
  }

  let parsed: { event?: string; tx_ref?: string; data?: { tx_ref?: string } };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const orderId = parsed.tx_ref ?? parsed.data?.tx_ref;
  if (!orderId) return c.json({ error: "missing tx_ref" }, 400);

  try {
    const verification = await verifyTransaction(env, orderId);
    if (verification.status !== "success") {
      return c.json({ ok: true, ignored: `status=${verification.status}` });
    }

    const db = getDb(env);
    const order = await getOrderWithItems(db, orderId);
    if (!order) {
      await notifyAdminChannel(env, `⚠️ Chapa payment for unknown order ${orderId}`);
      return c.json({ ok: true });
    }
    if (order.paymentStatus !== "pending") {
      return c.json({ ok: true, already: true });
    }

    const amountHalala = Math.round((verification.amount ?? order.totalHalala / 100) * 100);

    const { error } = await db.rpc("finalize_order_payment", {
      p_order_id: orderId,
      p_telegram_charge_id: null,
      p_provider_charge_id: verification.reference ?? `chapa:${orderId}`,
      p_amount_halala: amountHalala,
    });
    if (error) throw new Error(`finalize_order_payment: ${error.message}`);

    await notifyAdminChannel(env, `${formatAdminOrderAlert(order)}\n\n💳 Paid via Chapa`);
    const profile = await getProfileById(db, order.profileId).catch(() => null);
    if (profile?.telegramId) {
      const bot = createBot(env);
      await bot.api.sendMessage(profile.telegramId, buildReceiptText(order)).catch(() => {});
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error("chapa webhook error", err);
    return c.json({ error: "processing failed" }, 500);
  }
});

function buildReceiptText(order: OrderWithItems): string {
  const lines = [
    `✅ Payment received — thank you!`,
    ``,
    `Order: ${order.orderNo}`,
    ...order.items.map((i) => `• ${i.nameEn} × ${i.qty} — ${formatETB(i.subtotalHalala)}`),
    ``,
    `Total: ${formatETB(order.totalHalala)}`,
    `Deliver to: ${order.address}`,
  ];
  return lines.join("\n");
}
