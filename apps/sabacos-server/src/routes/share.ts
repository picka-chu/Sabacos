import { Hono } from "hono";
import { Bot, type InputFile } from "grammy";
import type { InlineQueryResult as InlineQueryResultType } from "@grammyjs/types";
import { getAppEnv, type AppEnv } from "../env.js";
import { requireUser, type UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getProductById } from "../db/catalog.js";
import { packSharePayload } from "../db/referrals.js";
import { formatETB, type Product } from "@sabacos/core";
import { escapeHtml } from "../bot/bot.js";
import { webAppUrl } from "../services/miniapp.js";

export const shareRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

shareRoutes.use("*", requireUser);

type ShareProduct = Pick<
  Product,
  "id" | "nameEn" | "nameAm" | "descriptionEn" | "descriptionAm" | "priceHalala" | "imageUrls"
>;

/** Telegram photo captions cap at 1024 chars (after entities parsing). */
export const SHARE_PHOTO_CAPTION_LIMIT = 1024;

/**
 * Attributed share link (Track 2): packs this user as the sharer so any
 * resulting sale credits their commission. Falls back to the plain product
 * link when the bot username isn't configured (still shareable, just
 * unattributed).
 */
export function buildShareLink(
  webappBase: string,
  botUsername: string | undefined,
  chatId: number,
  productId: string,
): string {
  const username = (botUsername || "").replace(/^@/, "");
  if (!username) return webAppUrl(webappBase, `/product/${productId}`);
  return `https://t.me/${username}?startapp=${packSharePayload(chatId, productId)}`;
}

/**
 * Professional share-sheet text: name, one-line benefit, price with the
 * half-now option, and the original-only guarantee. Plain text (no HTML —
 * t.me/share/url takes raw text).
 */
export function buildShareCaption(product: {
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

/**
 * Pure builder for the prepared inline result the mini app forwards natively
 * via Telegram.WebApp.shareMessage (Bot API 8.0+). Photo products become a
 * photo result with caption + Buy button; products without images become an
 * article result with the same text. The attributed link rides in the caption
 * as plain text so it survives forwards.
 */
export function buildShareInlineResult(product: ShareProduct, url: string): InlineQueryResultType<InputFile> {
  const rawCaption = buildShareCaption(product);
  const buyButton = { inline_keyboard: [[{ text: "🛍  Buy now", url }]] };
  const resultId = `share-${Date.now().toString(36)}`;

  const imageUrl = product.imageUrls[0];
  if (imageUrl) {
    const tail = `\n\n${url}`;
    // Escape FIRST, then truncate the head to what fits: escaping expands
    // (& → &amp;), so truncating raw text first can still exceed the limit
    // and get the whole caption rejected. The attributed URL tail is never cut.
    const escTail = escapeHtml(tail);
    const escHead = escapeHtml(rawCaption);
    const room = Math.max(0, SHARE_PHOTO_CAPTION_LIMIT - escTail.length);
    const cut =
      escHead.length > room
        ? escHead.slice(0, room).replace(/&[\w#]*$/, "")
        : escHead;
    return {
      type: "photo",
      id: resultId,
      photo_url: imageUrl,
      thumbnail_url: imageUrl,
      caption: `${cut}${escTail}`,
      parse_mode: "HTML",
      reply_markup: buyButton,
    };
  }

  const text = escapeHtml(`${rawCaption}\n\n${url}`);
  return {
    type: "article",
    id: resultId,
    title: product.nameEn,
    description: `${formatETB(product.priceHalala)} — 100% original`,
    input_message_content: {
      message_text: text,
      parse_mode: "HTML",
    },
    reply_markup: buyButton,
  };
}

async function loadShareTarget(db: ReturnType<typeof getDb>, productId: string, telegramId: number | null) {
  const product = await getProductById(db, productId);
  if (!product) return { error: "Product not found" as const };
  if (telegramId == null) return { error: "User has no Telegram ID" as const };
  return { product };
}

shareRoutes.post("/product/:id", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  const productId = c.req.param("id");

  const target = await loadShareTarget(db, productId, profile.telegramId);
  if ("error" in target) {
    const status = target.error === "Product not found" ? 404 : 400;
    return c.json({ error: target.error }, status);
  }
  const { product } = target;

  const url = buildShareLink(env.WEBAPP_URL, env.BOT_USERNAME, profile.telegramId as number, product.id);
  return c.json({ url, text: buildShareCaption(product), imageUrl: product.imageUrls[0] ?? null });
});

/**
 * Native forward flow: the server stores a prepared inline message
 * (photo + caption + Buy button) and hands the id to the mini app, which
 * opens Telegram's own chat picker via Telegram.WebApp.shareMessage —
 * nothing is ever posted into the user's bot chat.
 */
shareRoutes.post("/product/:id/prepare", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  const productId = c.req.param("id");

  const target = await loadShareTarget(db, productId, profile.telegramId);
  if ("error" in target) {
    const status = target.error === "Product not found" ? 404 : 400;
    return c.json({ error: target.error }, status);
  }
  const { product } = target;

  const url = buildShareLink(env.WEBAPP_URL, env.BOT_USERNAME, profile.telegramId as number, product.id);
  const result = buildShareInlineResult(product, url);

  try {
    const bot = new Bot(env.BOT_TOKEN);
    const prepared = await bot.api.savePreparedInlineMessage(profile.telegramId as number, result, {
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    });
    return c.json({ preparedId: prepared.id });
  } catch (err) {
    console.error("[share] savePreparedInlineMessage failed:", err);
    return c.json(
      { error: { code: "share_prepare_failed", message: "Could not prepare the share message" } },
      502,
    );
  }
});
