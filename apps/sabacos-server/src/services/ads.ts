import type { Language } from "@sabacos/core";
import type { Db } from "../db/client.js";
import {
  anyPromotableProducts,
  discountedProducts,
  topCategories,
  type DiscountCandidate,
} from "../db/marketing.js";
import { llamaAdCopy, type aiEnv } from "./ai.js";

export interface AdPayload {
  productId: string;
  headline: string;
  cta: string;
  discountPct: number | null;
}

const TEMPLATES: Record<Language, ((name: string, pct: number) => string)[]> = {
  en: [
    (n, p) => `✨ ${p}% off ${n} — today only`,
    (n) => `${n} is trending right now 🔥`,
    (n, p) => `Loved by many — ${n}, now −${p}%`,
    (n, p) => `Glow deal: ${n} at ${p}% off 💫`,
  ],
  am: [
    (n, p) => `✨ በ${n} ላይ ${p}% ቅናሽ — ለዛሬ ብቻ`,
    (n) => `${n} አሁን በጣም ይፈለጋል 🔥`,
    (n, p) => `ተወዳጅ ምርት — ${n}፣ አሁን −${p}%`,
    (n, p) => `የውበት እድል፦ ${n} በ${p}% ቅናሽ 💫`,
  ],
};

const CTAS: Record<Language, string[]> = {
  en: ["Shop now", "Grab yours", "See it"],
  am: ["አሁን ይግዙ", "ያንሱት", "ይመልከቱ"],
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function discountPct(p: DiscountCandidate): number | null {
  if (p.compareAtHalala == null || p.compareAtHalala <= p.priceHalala) return null;
  return Math.round(((p.compareAtHalala - p.priceHalala) / p.compareAtHalala) * 100);
}

function templateCopy(p: DiscountCandidate, lang: Language): AdPayload {
  const name = lang === "am" && p.nameAm ? p.nameAm : p.nameEn;
  const pct = discountPct(p) ?? 0;
  const day = Math.floor(Date.now() / 86_400_000);
  const pool = pct > 0 ? TEMPLATES[lang] : (TEMPLATES[lang].slice(1) as NonNullable<(typeof TEMPLATES)[Language]>);
  const pick = pool[hash(p.id + String(day)) % pool.length] ?? pool[0];
  if (!pick) return { productId: p.id, headline: name, cta: "Shop now", discountPct: pct > 0 ? pct : null };
  const headline = pick(name, Math.max(pct, 10));
  const cta = CTAS[lang][hash(p.id) % CTAS[lang].length] ?? "Shop now";
  return { productId: p.id, headline, cta, discountPct: pct > 0 ? pct : null };
}

/** AI micro-copy via Cloudflare Llama; returns null on any failure. */
async function aiCopy(
  env: aiEnv,
  p: DiscountCandidate,
  lang: Language,
  categoryName?: string,
): Promise<AdPayload | null> {
  const copy = await llamaAdCopy(
    env,
    { name: lang === "am" && p.nameAm ? p.nameAm : p.nameEn, category: categoryName, discountPct: discountPct(p) },
      lang,
  );
  if (!copy) return null;
  return { productId: p.id, headline: copy.headline, cta: copy.cta, discountPct: discountPct(p) };
}

interface CachedAd {
  productId: string;
  headline: string;
  cta: string;
  discountPct: number | null;
}

async function cachedCopy(
  db: Db,
  env: aiEnv,
  p: DiscountCandidate,
  lang: Language,
): Promise<AdPayload> {
  const key = `ad:${p.id}:${lang}:${discountPct(p) ?? 0}`;
  const { data } = await db
    .from("ad_copy_cache")
    .select("payload")
    .eq("cache_key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (data?.payload != null) return data.payload as CachedAd;

  // Cache-first (the KV trick): AI only runs once per product+Language per day.
  let copy = templateCopy(p, lang);
  const ai = await aiCopy(env, p, lang);
  if (ai) copy = ai;
  await db
    .from("ad_copy_cache")
    .upsert(
      {
        cache_key: key,
        payload: copy,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      { onConflict: "cache_key" },
    );
  return copy;
}

/**
 * Personalized banner: pick a discounted product from the categories the user
 * browsed recently; fall back to newest discounts, then any active product.
 */
export async function pickAdForUser(
  db: Db,
  profileId: string,
  lang: Language,
  env?: aiEnv,
): Promise<{ product: DiscountCandidate; ad: AdPayload } | null> {
  const tops = await topCategories(db, profileId).catch(() => []);
  let candidates: DiscountCandidate[] = [];
  if (tops.length > 0) {
    candidates = await discountedProducts(db, {
      categoryIds: tops.map((t) => t.categoryId),
      limit: 10,
    });
  }
  if (candidates.length === 0) candidates = await discountedProducts(db, { limit: 10 });
  if (candidates.length === 0) candidates = await anyPromotableProducts(db, 10);
  if (candidates.length === 0) return null;

  // Prefer the user's most-viewed category, else rotate daily.
  const preferred = tops[0]?.categoryId;
  const product =
    candidates.find((p) => p.categoryId === preferred) ??
    candidates[hash(profileId + String(Math.floor(Date.now() / 86_400_000))) % candidates.length] ??
    candidates[0];
  if (!product) return null;
  const ad = await cachedCopy(db, env ?? {}, product, lang);
  return { product, ad };
}
