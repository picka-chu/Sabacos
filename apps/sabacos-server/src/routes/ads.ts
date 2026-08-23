import { Hono } from "hono";
import { z } from "zod";
import { badRequest, safeParse } from "../errors.js";
import type { Language } from "@sabacos/core";
import { getAppEnv, type AppEnv } from "../env.js";
import type { UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import { getProductById } from "../db/catalog.js";
import { logProductView } from "../db/marketing.js";
import { pickAdForUser } from "../services/ads.js";
import { updateUserTasteVector, vectorEnabled } from "../services/vector.js";

export const adRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

const viewSchema = z.object({ productId: z.string().uuid() });

adRoutes.post("/track/view", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  const input = safeParse(viewSchema, await c.req.json().catch(() => null));

  const product = await getProductById(db, input.productId);
  if (!product) throw badRequest("Unknown product");

  // Fire-and-forget semantics: a failure here must never break browsing.
  try {
    await logProductView(db, profile.id, product.id, product.categoryId ?? null);
  } catch (err) {
    console.error("[ads] view log failed:", err);
  }
  // Update the user's Cloudflare taste vector (best-effort).
  if (vectorEnabled(env)) {
    await updateUserTasteVector(
      env,
      profile.id,
      `${product.nameEn} — ${product.categoryId ?? "cosmetics"} cosmetics beauty skincare`,
    ).catch((err) => console.error("[ads] taste vector update failed:", err));
  }
  return c.json({ ok: true });
});

adRoutes.get("/banner", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const profile = c.get("profile");
  const Language: Language = c.req.query("Language") === "am" ? "am" : "en";

  const picked = await pickAdForUser(db, profile.id, Language, env).catch((err) => {
    console.error("[ads] banner failed:", err);
    return null;
  });
  if (!picked) return c.json({ banner: null });

  const { product, ad } = picked;
  return c.json({
    banner: {
      productId: product.id,
      nameEn: product.nameEn,
      nameAm: product.nameAm,
      imageUrl: product.imageUrl,
      priceHalala: product.priceHalala,
      compareAtHalala: product.compareAtHalala,
      headline: ad.headline,
      cta: ad.cta,
      discountPct: ad.discountPct,
    },
  });
});
