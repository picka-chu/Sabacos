import { Bot, InlineKeyboard, type Context } from "grammy";
import {
  CURRENCY,
  formatETB,
  formatOrderNo,
  isAdminRole,
  isFullAdmin,
  translateStatus,
  type Order,
  type OrderWithItems,
  type ProfileRole,
} from "@sabacos/core";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import { getSettings } from "../db/settings.js";
import { getOrderById, getOrderItems, getOrderWithItems, getOrdersByProfile } from "../db/orders.js";
import { getProductsByIds } from "../db/catalog.js";
import { getProfileById, saveProfileContact, upsertTelegramProfile } from "../db/profiles.js";
import { getWaitlistConfig, getWaitlistEntryByCode } from "../db/waitlist.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Parse comma-separated Telegram user IDs from env var. */
function parseAdminTelegramIds(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
}

/**
 * Normalizes a channel id for the Bot API. Telegram accepts either the
 * numeric chat id (-100…) or the username WITHOUT a leading "@". Most
 * admins paste the handle from the channel; strip the "@" so it works.
 */
export function resolveChannelId(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

// Persistent bottom-of-chat keyboard (DurgerKing style). "Shop" is a native
// web_app button — it launches the mini app straight from the keyboard.
function mainMenuKeyboard(env: AppEnv, waitlistActive = false, role: ProfileRole = "customer") {
  if (waitlistActive) {
    return {
      keyboard: [
        [{ text: "📋  Join Waitlist", web_app: { url: env.WEBAPP_URL } }],
        [{ text: "ℹ️  Help" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }
  const rows: Array<Array<{ text: string; web_app?: { url: string } }>> = [
    [{ text: "🛍  Shop", web_app: { url: env.WEBAPP_URL } }],
    [{ text: "📦  My Orders" }, { text: "ℹ️  Help" }],
  ];
  if (isAdminRole(role)) {
    rows.push([{ text: "📊  Admin Dashboard", web_app: { url: env.ADMIN_DASHBOARD_URL } }]);
  }
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

const MENU_BUTTON_TEXTS = ["🛍  Shop", "📋  Join Waitlist", "📦  My Orders", "ℹ️  Help"] as const;

async function sendMyOrders(ctx: Context, env: AppEnv): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const db = getDb(env);
  const profile = await getProfileById(db, String(from.id)).catch(() => null);
  const orders = profile
    ? await getOrdersByProfile(db, profile.id).catch(() => [])
    : [];

  if (orders.length === 0) {
    await ctx.reply("📦 No orders yet — tap 🛍 Shop to place your first one!", {
      reply_markup: mainMenuKeyboard(env, false, profile?.role ?? "customer"),
    });
    return;
  }

  const lines = orders.slice(0, 5).map(
    (o) => `${statusEmoji(o.status)} ${o.orderNo} — ${translateStatus("en", o.status)} · ${formatETB(o.totalHalala)}`,
  );
  await ctx.reply(["📦 Your recent orders:", "", ...lines].join("\n"), {
    reply_markup: new InlineKeyboard().webApp("👀  View all orders", `${env.WEBAPP_URL}/orders`),
  });
}

function statusEmoji(status: Order["status"]): string {
  switch (status) {
    case "pending_payment": return "⏳";
    case "paid": return "✅";
    case "processing": return "🧴";
    case "shipped": return "🚚";
    case "delivered": return "🎉";
    default: return "❌";
  }
}

// ---------------------------------------------------------------- share flow

// The mini app asks the server to make the bot DM one of these one-time
// keyboards. Works on every Telegram client, unlike the in-app WebApp
// requestPhone/requestLocation APIs which need recent clients.
export async function sendShareRequest(
  env: AppEnv,
  telegramId: number,
  kind: "phone" | "location",
): Promise<void> {
  const bot = createBot(env);
  if (kind === "phone") {
    await bot.api.sendMessage(telegramId, [
      "📱 Almost done!",
      "",
      "Tap the button below to share your phone number with us —",
      "we'll only use it for order & delivery updates.",
    ].join("\n"), {
      reply_markup: {
        keyboard: [[{ text: "📱  Share my number", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }
  await bot.api.sendMessage(telegramId, [
    "📍 One more thing!",
    "",
    "Tap the button below to share your location —",
    "a precise GPS pin helps our courier find you and prices your delivery fairly.",
  ].join("\n"), {
    reply_markup: {
      keyboard: [[{ text: "📍  Share my location", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

function backToCheckoutKeyboard(env: AppEnv) {
  return new InlineKeyboard().webApp("✅  Back to the shop", `${env.WEBAPP_URL}/checkout`);
}

async function getShopSettings(env: AppEnv) {
  return getSettings(getDb(env)).catch(() => null);
}

export function createBot(env: AppEnv): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  bot.command("start", async (ctx) => {
    const db = getDb(env);
    const adminIds = parseAdminTelegramIds(env.ADMIN_TELEGRAM_IDS);
    let role: ProfileRole = "customer";

    if (ctx.from) {
      const profile = await upsertTelegramProfile(db, {
        telegramId: ctx.from.id,
        firstName: ctx.from.first_name ?? null,
        lastName: ctx.from.last_name ?? null,
        username: ctx.from.username ?? null,
      }).catch((err) => {
        console.error("start: profile upsert failed", err);
        return null;
      });

      if (profile) {
        role = profile.role;
        // Auto-promote users whose Telegram ID is in ADMIN_TELEGRAM_IDS
        if (adminIds.has(ctx.from.id) && !isFullAdmin(profile.role)) {
          try {
            await db
              .from("profiles")
              .update({ role: "admin" })
              .eq("id", profile.id);
            role = "admin";
          } catch (err) {
            console.error("start: auto-promote failed", err);
          }
        }
      }
    }

    const settings = await getShopSettings(env);
    const waitlistConfig = await getWaitlistConfig(db).catch(() => null);
    const waitlistActive = waitlistConfig?.isActive === true;
    const shopName = settings?.shopNameEn ?? "Sabacos";
    const firstName = ctx.from?.first_name ? escapeHtml(ctx.from.first_name) : "";

    // Check for referral deep link: /start ref_CODE
    const payload = ctx.match as string | undefined;
    let referralMsg = "";
    if (payload?.startsWith("ref_") && waitlistActive) {
      const code = payload.slice(4).toUpperCase();
      const referrer = await getWaitlistEntryByCode(db, code).catch(() => null);
      if (referrer) {
        referralMsg = "\n\n🔗 You were invited by a friend! Open the shop to claim your early-bird perk.";
      }
    }

    if (waitlistActive) {
      await ctx.reply(
        [
          `🌸 <b>${escapeHtml(shopName)}</b> is coming soon!`,
          "",
          `We're launching soon — join the waitlist to get exclusive early-bird discounts.`,
          "",
          `✨ Be among the first to shop premium cosmetics`,
          `💰 Early-bird members get a special discount`,
          `🎁 Refer friends for extra perks`,
          referralMsg,
        ].join("\n"),
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().webApp("📋  Join Waitlist", env.WEBAPP_URL),
        },
      );
      // Also update the persistent keyboard
      await ctx.reply("Tap below anytime to open the waitlist:", {
        reply_markup: mainMenuKeyboard(env, true, role),
      });
      return;
    }

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
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().webApp("🛍  Shop now", env.WEBAPP_URL) },
    );
  });

  bot.command("shop", async (ctx) => {
    const waitlistConfig = await getWaitlistConfig(getDb(env)).catch(() => null);
    if (waitlistConfig?.isActive) {
      await ctx.reply("📋  Waitlist is open — tap below to join:", {
        reply_markup: new InlineKeyboard().webApp("📋  Join Waitlist", env.WEBAPP_URL),
      });
      return;
    }
    await ctx.reply("🛍  Ready when you are:", {
      reply_markup: new InlineKeyboard().webApp("🛍  Open the shop", env.WEBAPP_URL),
    });
  });

  bot.command("orders", async (ctx) => {
    await sendMyOrders(ctx, env);
  });

  bot.command("help", async (ctx) => {
    const settings = await getShopSettings(env);
    const profile = ctx.from
      ? await getProfileById(getDb(env), String(ctx.from.id)).catch(() => null)
      : null;
    await ctx.reply(buildHelpText(settings?.shopPhone ?? null), {
      reply_markup: mainMenuKeyboard(env, false, profile?.role ?? "customer"),
    });
  });

  // Reply-keyboard buttons (persistent menu at the bottom of the chat).
  bot.on("message:text").filter((ctx) => ctx.message.text.trim() === "📦  My Orders", async (ctx) => {
    await sendMyOrders(ctx, env);
  });

  bot.on("message:text").filter((ctx) => ctx.message.text.trim() === "ℹ️  Help", async (ctx) => {
    const settings = await getShopSettings(env);
    const profile = await getProfileById(getDb(env), String(ctx.from.id)).catch(() => null);
    await ctx.reply(buildHelpText(settings?.shopPhone ?? null), {
      reply_markup: mainMenuKeyboard(env, false, profile?.role ?? "customer"),
    });
  });

  bot.on("message:text").filter((ctx) => ctx.message.text.trim() === "📋  Join Waitlist", async (ctx) => {
    await ctx.reply("📋  Opening the waitlist:", {
      reply_markup: new InlineKeyboard().webApp("📋  Join Waitlist", env.WEBAPP_URL),
    });
  });

  bot.on("message:text").filter((ctx) => ctx.message.text.trim() === "🛍  Shop", async (ctx) => {
    const waitlistConfig = await getWaitlistConfig(getDb(env)).catch(() => null);
    if (waitlistConfig?.isActive) {
      await ctx.reply("📋  Waitlist is open — tap below to join:", {
        reply_markup: new InlineKeyboard().webApp("📋  Join Waitlist", env.WEBAPP_URL),
      });
      return;
    }
    await ctx.reply("🛍  Ready when you are:", {
      reply_markup: new InlineKeyboard().webApp("🛍  Open the shop", env.WEBAPP_URL),
    });
  });

  bot.callbackQuery("show_help", async (ctx) => {
    const settings = await getShopSettings(env);
    const profile = ctx.from
      ? await getProfileById(getDb(env), String(ctx.from.id)).catch(() => null)
      : null;
    await ctx.answerCallbackQuery();
    await ctx.reply(buildHelpText(settings?.shopPhone ?? null), {
      reply_markup: mainMenuKeyboard(env, false, profile?.role ?? "customer"),
    });
  });

  // Friendly fallback for any non-command text that isn't a menu button
  bot.on("message:text").filter(
    (ctx) =>
      !ctx.message.text.startsWith("/") &&
      !MENU_BUTTON_TEXTS.includes(ctx.message.text.trim() as (typeof MENU_BUTTON_TEXTS)[number]),
    async (ctx) => {
    const settings = await getShopSettings(env);
    const shopName = settings?.shopNameEn ?? "Sabacos";
    const profile = await getProfileById(getDb(env), String(ctx.from.id)).catch(() => null);
    await ctx.reply(
      `I'm the ${escapeHtml(shopName)} assistant 🌸 — I take orders, payments, and questions about deliveries.\n\nTap a button below to get started:`,
      { reply_markup: mainMenuKeyboard(env, false, profile?.role ?? "customer") },
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

  // User shared their number via the bot's request keyboard → save it and
  // send them straight back to the mini app.
  bot.on("message:contact", async (ctx) => {
    const from = ctx.from;
    if (!from || ctx.message.contact.user_id !== from.id) return; // only accept own contact
    const db = getDb(env);
    const profile =
      (await getProfileById(db, String(from.id)).catch(() => null)) ??
      (await upsertTelegramProfile(db, { telegramId: from.id }));
    await saveProfileContact(db, profile.id, {
      phone: ctx.message.contact.phone_number,
    });
    await ctx.reply("✅ Phone saved! Tap below to continue where you left off.", {
      reply_markup: backToCheckoutKeyboard(env),
    });
  });

  bot.on("message:location", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const db = getDb(env);
    const profile =
      (await getProfileById(db, String(from.id)).catch(() => null)) ??
      (await upsertTelegramProfile(db, { telegramId: from.id }));
    await saveProfileContact(db, profile.id, {
      lastLatitude: ctx.message.location.latitude,
      lastLongitude: ctx.message.location.longitude,
    });
    await ctx.reply([
      "📍 Location saved!",
      "",
      "Tap below to continue checkout — your delivery price updates automatically.",
      "Tip: for a precise door delivery, also describe nearby landmarks in the address field.",
    ].join("\n"), {
      reply_markup: backToCheckoutKeyboard(env),
    });
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

      await notifyAdminChannelWithButtons(env, formatAdminOrderAlert(order), order.id);
      await sendReceipt(ctx, env, order);
    } catch (err) {
      console.error("successful_payment error", err);
      await notifyAdminChannel(env, `⚠️ Error finalizing payment: ${String(err)}`);
    }
  });

  // ---- Order status callback buttons (admin/staff quick actions) ----
  bot.callbackQuery(/^order:(.+):(.+)$/, async (ctx) => {
    const match = ctx.match;
    if (!match) return;
    const orderId = match[1];
    const newStatus = match[2];
    if (!orderId || !newStatus) return;
    const from = ctx.from;
    if (!from) return;

    const db = getDb(env);
    const profile = await getProfileById(db, String(from.id)).catch(() => null);

    // Only admin and staff can use these buttons; delivery can only mark "delivered"
    const allowedRoles = ["admin", "staff"];
    if (!profile || (!allowedRoles.includes(profile.role) && !(profile.role === "delivery" && newStatus === "delivered"))) {
      await ctx.answerCallbackQuery({ text: "Not authorized", show_alert: true });
      return;
    }

    // Validate the status transition
    const { canTransitionOrder } = await import("@sabacos/core");
    const order = await getOrderById(db, orderId);
    if (!order) {
      await ctx.answerCallbackQuery({ text: "Order not found", show_alert: true });
      return;
    }

    if (!canTransitionOrder(order.status, newStatus as any)) {
      await ctx.answerCallbackQuery({
        text: `Cannot transition from ${order.status} to ${newStatus}`,
        show_alert: true,
      });
      return;
    }

    // Update order status
    const { updateOrderStatus } = await import("../db/orders.js");
    await updateOrderStatus(db, orderId, newStatus as any);

    // Notify admin channel
    const statusLabel = newStatus.replace(/_/g, " ");
    await notifyAdminChannel(env, `✅ Order ${order.orderNo} → ${statusLabel} (by ${profile.firstName ?? "staff"})`);

    // Update the callback message
    await ctx.answerCallbackQuery({ text: `Order marked as ${statusLabel}` });
    await ctx.editMessageText(
      `✅ Order ${order.orderNo} updated to: ${statusLabel}\nBy: ${profile.firstName ?? "Staff"}`,
    ).catch(() => {});
  });

  bot.catch((err) => {
    console.error("bot error", err.error);
  });

  return bot;
}

export function makeCreateInvoiceLink(env: AppEnv, bot: Bot) {
  return async (params: {
    payload: string;
    title: string;
    description: string;
    currency: string;
    prices: { label: string; amount: number }[];
  }): Promise<string> => {
    const link = await bot.api.createInvoiceLink(
      params.title,
      params.description,
      params.payload,
      env.CHAPA_PROVIDER_TOKEN,
      params.currency,
      params.prices.map((p) => ({ label: p.label, amount: p.amount })),
    );
    if (!link) throw new Error("createInvoiceLink failed: no link returned");
    return link;
  };
}

function formatOrderLines(order: OrderWithItems): string {
  const lines = order.items
    .map((i) => `• ${i.nameEn} × ${i.qty} — ${formatETB(i.subtotalHalala)}`)
    .join("\n");
  return lines || "—";
}

export function formatAdminOrderAlert(order: OrderWithItems): string {
  const discountLine = order.discountHalala > 0
    ? `Discount (${order.discountPercent}%): -${formatETB(order.discountHalala)}`
    : null;
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
    discountLine,
    `Delivery: ${order.deliveryFeeHalala > 0 ? formatETB(order.deliveryFeeHalala) : "Free"}`,
    `*Total: ${formatETB(order.totalHalala)}*`,
  ]
    .filter(Boolean)
    .join("\n");
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
  const discountLine = order.discountHalala > 0
    ? `Discount (${order.discountPercent}%): -${formatETB(order.discountHalala)}`
    : null;
  const lines = [
    `✅ *Payment received! Thank you for your order.*`,
    ``,
    `Order: ${order.orderNo}`,
    `Items:`,
    formatOrderLines(order),
    ``,
    `Subtotal: ${formatETB(order.subtotalHalala)}`,
    discountLine,
    `Delivery: ${order.deliveryFeeHalala > 0 ? formatETB(order.deliveryFeeHalala) : "Free"}`,
    `Total: ${formatETB(order.totalHalala)}`,
    ``,
    `Deliver to: ${order.address}`,
    `Phone: ${order.phone}`,
  ]
    .filter(Boolean);
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}

export async function notifyAdminChannel(env: AppEnv, text: string): Promise<void> {
  const settings = await getSettings(getDb(env)).catch(() => null);
  const channelId = resolveChannelId(settings?.adminChannelId ?? env.ADMIN_CHANNEL_ID);
  if (!channelId) return;
  const bot = new Bot(env.BOT_TOKEN);
  await bot.api.sendMessage(channelId, text, { parse_mode: "HTML" }).catch((err) => {
    console.error(`admin channel notification failed (${channelId}):`, err);
  });
}

/** Notify admin channel with inline buttons for quick order status updates. */
export async function notifyAdminChannelWithButtons(
  env: AppEnv,
  text: string,
  orderId: string,
): Promise<void> {
  const settings = await getSettings(getDb(env)).catch(() => null);
  const channelId = resolveChannelId(settings?.adminChannelId ?? env.ADMIN_CHANNEL_ID);
  if (!channelId) return;
  const bot = new Bot(env.BOT_TOKEN);
  await bot.api
    .sendMessage(channelId, text, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⚙️ Processing", callback_data: `order:${orderId}:processing` },
            { text: "📦 Shipped", callback_data: `order:${orderId}:shipped` },
          ],
          [
            { text: "✅ Delivered", callback_data: `order:${orderId}:delivered` },
            { text: "❌ Cancel", callback_data: `order:${orderId}:cancelled` },
          ],
        ],
      },
    })
    .catch((err) => {
      console.error(`admin channel notification failed (${channelId}):`, err);
    });
}

export async function postProductToChannel(
  env: AppEnv,
  product: { id: string; nameEn: string; nameAm: string; descriptionEn: string; descriptionAm: string; priceHalala: number; imageUrls: string[] },
): Promise<void> {
  const settings = await getSettings(getDb(env)).catch(() => null);
  const channelId = resolveChannelId(settings?.adminChannelId ?? env.ADMIN_CHANNEL_ID);
  if (!channelId) return;

  const price = (product.priceHalala / 100).toFixed(2);
  // HTML parse mode: escape every dynamic field. Using Markdown here fails
  // whenever product text contains _, *, [, `, etc., silently dropping the post.
  const caption = [
    `<b>${escapeHtml(product.nameEn)}</b>`,
    product.nameAm ? `<i>${escapeHtml(product.nameAm)}</i>` : "",
    "",
    product.descriptionEn ? escapeHtml(product.descriptionEn).slice(0, 300) : "",
    "",
    `💰 <b>${price} ETB</b>`,
  ]
    .filter(Boolean)
    .join("\n");

  let webAppUrl: string;
  try {
    webAppUrl = `${env.WEBAPP_URL.replace(/\/$/, "")}/product/${product.id}`;
    // Telegram requires a secure, real https URL for web_app buttons.
    if (!/^https:\/\//i.test(webAppUrl)) throw new Error("WEBAPP_URL must be https");
  } catch (err) {
    console.error("postProductToChannel skipped (no valid WEBAPP_URL):", err);
    return;
  }

  const bot = new Bot(env.BOT_TOKEN);

  try {
    const photo = product.imageUrls[0];
    if (photo) {
      await bot.api.sendPhoto(channelId, photo, {
        caption,
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().webApp("🛍  Order now", webAppUrl),
      });
    } else {
      await bot.api.sendMessage(channelId, caption, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().webApp("🛍  Order now", webAppUrl),
      });
    }
  } catch (err) {
    const reason =
      err instanceof Error && err.message.toLowerCase().includes("chat not found")
        ? `${channelId} — is the bot an ADMIN of this channel? (Use the channel's @-less username or numeric id -100…)`
        : `for ${channelId}`;
    console.error(`postProductToChannel failed ${reason}:`, err);
  }
}

/**
 * Sends a test message to the configured channel so the admin can verify the
 * bot has access before relying on product posts. Returns the resolved
 * channel id; throws a readable error when the channel is misconfigured.
 */
export async function testAdminChannel(env: AppEnv): Promise<{ channelId: string; sent: boolean }> {
  const settings = await getSettings(getDb(env)).catch(() => null);
  const channelId = resolveChannelId(settings?.adminChannelId ?? env.ADMIN_CHANNEL_ID);
  if (!channelId) throw new Error("No admin channel id configured (Settings → Admin channel ID)");

  const bot = new Bot(env.BOT_TOKEN);
  try {
    await bot.api.sendMessage(channelId, "✅ Sabacos channel test — product posts will appear here.", {
      parse_mode: "HTML",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not post to "${channelId}". ${msg} — make sure this is the channel's @-less username (e.g. mychannel) or numeric id (e.g. -1001234567890) and that the bot is an admin of the channel.`,
    );
  }
  return { channelId, sent: true };
}