import { Hono } from "hono";
import { getAppEnv, type AppEnv } from "../env.js";
import { requireUser, type UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getProductById } from "../db/catalog.js";
import { packSharePayload } from "../db/referrals.js";
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

  const chatId = profile.telegramId;
  if (chatId == null) {
    return c.json({ error: "User has no Telegram ID" }, 400);
  }

  // Attributed share link (Track 2): packs this user as the sharer so any
  // resulting sale credits their commission. Falls back to the plain product
  // link when the bot username isn't configured (still shareable, just
  // unattributed). The client opens this in the native share sheet so the
  // user picks the chat — bot-sent messages lose their buttons on forward.
  const username = (env.BOT_USERNAME || "").replace(/^@/, "");
  const webAppUrl = `${env.WEBAPP_URL.replace(/\/$/, "")}/product/${product.id}`;
  const url = username
    ? `https://t.me/${username}?startapp=${packSharePayload(chatId, product.id)}`
    : webAppUrl;

  return c.json({ url, text: shareCaption(product) });
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
