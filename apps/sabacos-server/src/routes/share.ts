import { Hono } from "hono";
import { Bot, InlineKeyboard } from "grammy";
import { escapeHtml } from "../bot/bot.js";
import { getAppEnv, type AppEnv } from "../env.js";
import { requireUser, type UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getProductById } from "../db/catalog.js";
import { formatETB } from "@sabacos/core";

export const shareRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

shareRoutes.use("*", requireUser);

shareRoutes.post("/product/:id", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  const productId = c.req.param("id");

  const product = await getProductById(db, productId);
  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }

  const webAppUrl = `${env.WEBAPP_URL.replace(/\/$/, "")}/product/${product.id}`;
  if (!/^https:\/\//i.test(webAppUrl)) {
    return c.json({ error: "WEBAPP_URL must be https" }, 500);
  }

  const lang = profile.language === "am" ? "am" : "en";
  const name = lang === "am" ? product.nameAm : product.nameEn;
  const desc = lang === "am" ? product.descriptionAm : product.descriptionEn;
  const price = formatETB(product.priceHalala);

  const lines = [
    `<b>${escapeHtml(name)}</b>`,
    lang === "en" && product.nameAm ? `<i>${escapeHtml(product.nameAm)}</i>` : "",
    lang === "am" && product.nameEn ? `<i>${escapeHtml(product.nameEn)}</i>` : "",
    "",
    desc ? escapeHtml(desc).slice(0, 300) : "",
    "",
    `💰 <b>${escapeHtml(price)}</b>`,
  ];
  const caption = lines.filter(Boolean).join("\n");

  const bot = new Bot(env.BOT_TOKEN);
  const chatId = profile.telegramId;
  if (chatId == null) {
    return c.json({ error: "User has no Telegram ID" }, 400);
  }
  const keyboard = new InlineKeyboard().webApp("🛍 Buy Now", webAppUrl);

  try {
    const photo = product.imageUrls[0];
    if (photo) {
      await bot.api.sendPhoto(chatId, photo, {
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } else {
      await bot.api.sendMessage(chatId, caption, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`share/product failed for user ${chatId}:`, msg);
    return c.json({ error: `Failed to send: ${msg}` }, 500);
  }
});
