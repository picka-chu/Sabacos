import { Hono } from "hono";
import { Bot, InlineKeyboard } from "grammy";
import { getAppEnv, type AppEnv } from "../env.js";
import { requireUser, type UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getProductById } from "../db/catalog.js";
import { packSharePayload } from "../db/referrals.js";
import { formatETB } from "@sabacos/core";
import { escapeHtml } from "../bot/bot.js";

export const shareRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

shareRoutes.use("*", requireUser);

shareRoutes.post("/product/:id", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  const productId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { deliver?: boolean };

  const product = await getProductById(db, productId);
  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }

  const chatId = profile.telegramId;
  if (chatId == null) {
    return c.json({ error: "User has no Telegram ID" }, 400);
  }

  // Attributed share link (Track 2): packs this user as the sharer so any
  // resulting sale credits their commission. Falls back to the plain product
  // link when the bot username isn't configured (still shareable, just
  // unattributed).
  const username = (env.BOT_USERNAME || "").replace(/^@/, "");
  const webAppUrl = `${env.WEBAPP_URL.replace(/\/$/, "")}/product/${product.id}`;
  const url = username
    ? `https://t.me/${username}?startapp=${packSharePayload(chatId, product.id)}`
    : webAppUrl;

  const text = shareCaption(product);
  const imageUrl = product.imageUrls[0] ?? null;

  // Deliver mode: bot sends the photo card into this user's chat so the
  // share carries the product image + a plain-text attributed link (survives
  // forwards) and a Buy Now url button (not webApp — those strip on forward).
  if (body.deliver) {
    try {
      const bot = new Bot(env.BOT_TOKEN);
      const kb = new InlineKeyboard().url("🛍  Buy now", url);
      const caption = `${escapeHtml(text)}\n\n${escapeHtml(url)}`;
      if (imageUrl) {
        await bot.api.sendPhoto(chatId, imageUrl, {
          caption,
          parse_mode: "HTML",
          reply_markup: kb,
        });
      } else {
        await bot.api.sendMessage(chatId, caption, {
          parse_mode: "HTML",
          reply_markup: kb,
        });
      }
      return c.json({ url, text, imageUrl, delivered: true });
    } catch {
      // Bot send failed (privacy, flood, etc.) — client falls back to the sheet.
      return c.json({ url, text, imageUrl, delivered: false });
    }
  }

  return c.json({ url, text, imageUrl });
});

/**
 * Professional share-sheet text: name, one-line benefit, price with the
 * half-now option, and the original-only guarantee. Plain text (no HTML —
 * t.me/share/url takes raw text).
 */
function shareCaption(product: {
  nameEn: string;
  nameAm: string;
  descriptionEn: string;
  descriptionAm: string;
  priceHalala: number;
}): string {
  const price = formatETB(product.priceHalala);
  const half = formatETB(Math.round(product.priceHalala / 2));
  const benefit = (product.descriptionEn || product.descriptionAm || "").split("\n")[0]?.slice(0, 120) ?? "";
  const lines = [
    `✨ ${product.nameEn}`,
    product.nameAm && product.nameAm !== product.nameEn ? product.nameAm : "",
    benefit,
    "",
    `💰 ${price} — or pay ${half} now, rest on delivery`,
    "✅ 100% original · Delivered in Addis in 1–3 days",
  ];
  return lines.filter((l) => l && l.trim().length > 0).join("\n");
}
