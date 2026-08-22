import { Bot, InlineKeyboard, type Context } from "grammy";
import {
  CURRENCY,
  formatETB,
  formatOrderNo,
  translateStatus,
  type Order,
  type OrderWithItems,
} from "@sabacos/core";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import { getSettings } from "../db/settings.js";
import { getOrderById, getOrderItems, getOrderWithItems } from "../db/orders.js";
import { getProductsByIds } from "../db/catalog.js";
import { getProfileById, upsertTelegramProfile } from "../db/profiles.js";
import type { SendInvoiceParams } from "../services/checkout.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mainMenuKeyboard(env: AppEnv): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("🛍  Shop Now", env.WEBAPP_URL)
    .webApp("📦  My Orders", `${env.WEBAPP_URL}/orders`)
    .row()
    .text("ℹ️  Help", "show_help");
}

async function getShopSettings(env: AppEnv) {
  return getSettings(getDb(env)).catch(() => null);
}

export function createBot(env: AppEnv): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  bot.command("start", async (ctx) => {
    if (ctx.from) {
      // Trusted identity straight from Telegram's webhook — create the
      // account before the user ever opens the mini app.
      await upsertTelegramProfile(getDb(env), {
        telegramId: ctx.from.id,
        firstName: ctx.from.first_name ?? null,
        lastName: ctx.from.last_name ?? null,
        username: ctx.from.username ?? null,
      }).catch((err) => console.error("start: profile upsert failed", err));
    }

    const settings = await getShopSettings(env);
    const shopName = settings?.shopNameEn ?? "Sabacos";
    const firstName = ctx.from?.first_name ? escapeHtml(ctx.from.first_name) : "";
    await ctx.reply(
      [
        `🌸 Welcome to <b>${escapeHtml(shopName)}</b>${firstName ? `, ${firstName}` : ""}!`,
        "",
        `Premium cosmetics, delivered to your door — all inside Telegram.`,
        "",
        `✨ Curated skincare, makeup & fragrance`,
        `💳 Secure checkout powered by Chapa`,
        `🚚 Live order tracking until delivery`,
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: mainMenuKeyboard(env) },
    );
  });

  bot.command("shop", async (ctx) => {
    await ctx.reply("🛍  Ready when you are:", {
      reply_markup: new InlineKeyboard().webApp("🛍  Open the shop", env.WEBAPP_URL),
    });
  });

  bot.command("orders", async (ctx) => {
    await ctx.reply("📦 Your orders, all in one place:", {
      reply_markup: new InlineKeyboard().webApp("📦  View my orders", `${env.WEBAPP_URL}/orders`),
    });
  });

  bot.command("help", async (ctx) => {
    const settings = await getShopSettings(env);
    await ctx.reply(buildHelpText(settings?.shopPhone ?? null), {
      reply_markup: mainMenuKeyboard(env),
    });
  });

  bot.callbackQuery("show_help", async (ctx) => {
    const settings = await getShopSettings(env);
    await ctx.answerCallbackQuery();
    await ctx.reply(buildHelpText(settings?.shopPhone ?? null), {
      reply_markup: mainMenuKeyboard(env),
    });
  });

  // Friendly fallback for any non-command text
  bot.on("message:text").filter((ctx) => !ctx.message.text.startsWith("/"), async (ctx) => {
    const settings = await getShopSettings(env);
    const shopName = settings?.shopNameEn ?? "Sabacos";
    await ctx.reply(
      `I'm the ${escapeHtml(shopName)} assistant 🌸 — I take orders, payments, and questions about deliveries.\n\nTap a button below to get started:`,
      { reply_markup: mainMenuKeyboard(env) },
    );
  });

  bot.command("admin", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const db = getDb(env);
    const profile = await getProfileById(db, String(from.id)).catch(() => null);
    if (profile?.role !== "admin") {
      await ctx.reply("You are not authorized to access the admin panel.");
      return;
    }
    await ctx.reply(`Admin Dashboard: ${env.ADMIN_DASHBOARD_URL}`);
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const db = getDb(env);
    try {
      const order = await getOrderById(db, q.invoice_payload);
      if (!order) {
        await ctx.answerPreCheckoutQuery(false, { error_message: "Order not found." });
        return;
      }
      if (order.status !== "pending_payment" || order.paymentStatus !== "pending") {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: "This order is no longer awaiting payment.",
        });
        return;
      }
      if (q.total_amount !== order.totalHalala || q.currency !== CURRENCY) {
        await ctx.answerPreCheckoutQuery(false, { error_message: "Order details changed. Please retry." });
        return;
      }

      const items = await getOrderItems(db, order.id);
      const products = await getProductsByIds(db, items.map((i) => i.productId));
      const stockById = new Map(products.map((p) => [p.id, p.stock]));
      for (const item of items) {
        const stock = stockById.get(item.productId) ?? 0;
        if (stock < item.qty) {
          await ctx.answerPreCheckoutQuery(false, {
            error_message: `Insufficient stock for ${item.nameEn}.`,
          });
          return;
        }
      }

      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("pre_checkout error", err);
      await ctx
        .answerPreCheckoutQuery(false, { error_message: "Something went wrong. Please try again." })
        .catch(() => {});
    }
  });

  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const db = getDb(env);
    try {
      const { data: rpcStatus, error: rpcError } = await db.rpc("finalize_order_payment", {
        p_order_id: payment.invoice_payload,
        p_telegram_charge_id: payment.telegram_payment_charge_id,
        p_provider_charge_id: payment.provider_payment_charge_id,
        p_amount_halala: payment.total_amount,
      });
      if (rpcError) throw new Error(`finalize_order_payment: ${rpcError.message}`);

      if (rpcStatus === "already_processed") return;

      if (rpcStatus !== "ok") {
        await db
          .from("orders")
          .update({ status: "cancelled", payment_status: "failed" })
          .eq("id", payment.invoice_payload);
        await notifyAdminChannel(env, `⚠️ Payment received but order could not be finalized (${rpcStatus}). Order: ${payment.invoice_payload}`);
        await ctx.reply(
          "We received your payment, but could not complete the order due to a stock issue. Our team will contact you shortly to resolve this.",
        ).catch(() => {});
        return;
      }

      const order = await getOrderWithItems(db, payment.invoice_payload);
      if (!order) {
        await notifyAdminChannel(env, `⚠️ Payment finalized for missing order ${payment.invoice_payload}`);
        return;
      }

      await notifyAdminChannel(env, formatAdminOrderAlert(order));
      await sendReceipt(ctx, env, order);
    } catch (err) {
      console.error("successful_payment error", err);
      await notifyAdminChannel(env, `⚠️ Error finalizing payment: ${String(err)}`);
    }
  });

  bot.catch((err) => {
    console.error("bot error", err.error);
  });

  return bot;
}

export function makeSendInvoice(env: AppEnv, bot: Bot) {
  return async (params: SendInvoiceParams): Promise<void> => {
    const result = await bot.api.sendInvoice(
      params.chatId,
      params.title,
      params.description,
      params.payload,
      params.currency,
      params.prices.map((p) => ({ label: p.label, amount: p.amount })),
      { provider_token: env.CHAPA_PROVIDER_TOKEN },
    );
    if (!result) {
      throw new Error("sendInvoice failed: no result");
    }
  };
}

function formatOrderLines(order: OrderWithItems): string {
  const lines = order.items
    .map((i) => `• ${i.nameEn} × ${i.qty} — ${formatETB(i.subtotalHalala)}`)
    .join("\n");
  return lines || "—";
}

function formatAdminOrderAlert(order: OrderWithItems): string {
  return [
    `🛍 *New paid order*`,
    ``,
    `Order: ${order.orderNo}`,
    `Customer: ${order.customerName} (${order.phone})`,
    `Address: ${order.address}`,
    `Items:`,
    formatOrderLines(order),
    ``,
    `Subtotal: ${formatETB(order.subtotalHalala)}`,
    `Delivery: ${order.deliveryFeeHalala > 0 ? formatETB(order.deliveryFeeHalala) : "Free"}`,
    `*Total: ${formatETB(order.totalHalala)}*`,
  ].join("\n");
}

function buildHelpText(shopPhone: string | null): string {
  return [
    "🛍  How ordering works",
    "",
    '1️⃣  Tap "Shop Now" and browse products',
    "2️⃣  Add items to your cart",
    "3️⃣  Tap Checkout and confirm your address",
    "4️⃣  Pay securely right inside Telegram (via Chapa)",
    "",
    "📦  You'll get live status updates as your order is prepared and shipped.",
    shopPhone ? `\n☎️  Questions? Call us: ${shopPhone}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function registerBotDefaults(bot: Bot, env: AppEnv): Promise<void> {
  await Promise.allSettled([
    bot.api.setMyCommands([
      { command: "start", description: "Welcome & main menu 🌸" },
      { command: "shop", description: "Browse the catalog 🛍" },
      { command: "orders", description: "View your orders 📦" },
      { command: "help", description: "How it works ℹ️" },
    ]),
    bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "🛍  Shop",
        web_app: { url: env.WEBAPP_URL },
      },
    }),
  ]);
}

export async function sendReceipt(ctx: Context, env: AppEnv, order: OrderWithItems): Promise<void> {
  const lines = [
    `✅ *Payment received! Thank you for your order.*`,
    ``,
    `Order: ${order.orderNo}`,
    `Items:`,
    formatOrderLines(order),
    ``,
    `Subtotal: ${formatETB(order.subtotalHalala)}`,
    `Delivery: ${order.deliveryFeeHalala > 0 ? formatETB(order.deliveryFeeHalala) : "Free"}`,
    `Total: ${formatETB(order.totalHalala)}`,
    ``,
    `Deliver to: ${order.address}`,
    `Phone: ${order.phone}`,
  ];
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}

export async function notifyAdminChannel(env: AppEnv, text: string): Promise<void> {
  const settings = await getSettings(getDb(env)).catch(() => null);
  const channelId = settings?.adminChannelId ?? env.ADMIN_CHANNEL_ID;
  if (!channelId) return;
  const bot = new Bot(env.BOT_TOKEN);
  await bot.api.sendMessage(channelId, text, { parse_mode: "Markdown" }).catch((err) => {
    console.error("admin channel notification failed", err);
  });
}