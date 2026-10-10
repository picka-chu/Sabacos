/**
 * Sabacos automated marketing team (Gemini-powered).
 *
 * Six jobs run on their own cadence: price drops, new arrivals, restocks,
 * abandoned carts, win-back, and referral nudges. Every message is
 * personalized by Gemini (EN) with hand-written Amharic fallbacks, sent
 * with a deep-link button, and logged for frequency caps:
 *   - global: no profile gets any agent message more often than every 3 days
 *   - per-job cooldowns (carts 7d, win-back/nudges 30d, product promos 30d)
 *   - quiet hours 21:00–08:00 Africa/Addis_Ababa (never wake anyone)
 *
 * Master switch: MARKETING_AGENT=off. Runs alongside the legacy hourly
 * discount sweep; both consult the same logs so nobody gets double-pinged.
 */
import type { Bot } from "grammy";
import type { AppEnv } from "../env.js";
import { getDb, type Db } from "../db/client.js";
import { geminiText } from "./ai.js";
import { formatETB } from "@sabacos/core";
import {
  discountedProducts,
  getAgentJobCursor,
  logAgentMessage,
  logNotification,
  notifyTargetsForCategories,
  recentlyMessagedAny,
  recentlyNotifiedProfileIds,
  setAgentJobCursor,
  type NotifyTarget,
} from "../db/marketing.js";
import { log } from "../log.js";

export const AGENT_COOLDOWN_DAYS = 3;
export const AGENT_TZ = "Africa/Addis_Ababa";

/** Pure: inside nightly quiet hours (21:00–08:00 Addis)? */
export function isQuietHours(now: Date, tz = AGENT_TZ): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now),
  );
  return hour >= 21 || hour < 8;
}

/** Pure: is a job due given its last run? */
export function jobDue(lastRunIso: string | null, minIntervalMs: number, nowMs: number): boolean {
  if (!lastRunIso) return true;
  const last = Date.parse(lastRunIso);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= minIntervalMs;
}

type Target = NotifyTarget & { language: "en" | "am" };

/** Attach language to targets with one batched lookup. */
async function withLanguages(db: Db, targets: NotifyTarget[]): Promise<Target[]> {
  if (targets.length === 0) return [];
  const langById = new Map<string, "en" | "am">();
  try {
    const { data } = await db
      .from("profiles")
      .select("id, language")
      .in("id", targets.map((t) => t.profileId));
    for (const p of ((data ?? []) as Array<{ id: string; language?: string | null }>)) {
      langById.set(p.id, p.language === "am" ? "am" : "en");
    }
  } catch { /* default English */ }
  return targets.map((t) => ({ ...t, language: langById.get(t.profileId) ?? "en" }));
}

/** Drop targets inside the global cooldown window. */
async function cooledDown(db: Db, targets: Target[], days = AGENT_COOLDOWN_DAYS): Promise<Target[]> {
  const out: Target[] = [];
  for (const t of targets) {
    try {
      if (await recentlyMessagedAny(db, t.profileId, days)) continue;
    } catch { /* fail open */ }
    out.push(t);
  }
  return out;
}

/** Gemini EN body with template fallback; Amharic always from template. */
async function promoCopy(
  env: AppEnv,
  prompt: string,
  fallbackEn: string,
): Promise<string> {
  try {
    const text = await geminiText(
      env,
      `${prompt}\nRules: 2-3 flowing sentences, 40-55 words. Open with a warm hook, mention one concrete benefit, close with a light call to shop. Do NOT repeat the price or brand sign-off (added automatically). Plain text only: no markdown, no quotes, no hashtags, no links, no placeholders like [name], no greeting. Never use these words: unleash, elevate, game-changer, delve, embark, tapestry.`,
      { maxOutputTokens: 280, timeoutMs: 20_000 },
    );
    const cleaned = cleanCopy(text);
    if (cleaned) return cleaned;
  } catch { /* fall through to template */ }
  return fallbackEn;
}

/** Localized "Now X · was Y" line (formatETB already appends ETB). */
export function priceLineFor(
  lang: "en" | "am",
  priceHalala: number,
  compareAtHalala?: number | null,
): string {
  const price = formatETB(priceHalala);
  if (compareAtHalala != null && compareAtHalala > priceHalala) {
    return lang === "am"
      ? `አሁን ${price} · ነበር ${formatETB(compareAtHalala)}`
      : `Now ${price} · was ${formatETB(compareAtHalala)}`;
  }
  return price;
}

/**
 * Rich multi-line promo body: headline, sub-line, AI/template copy, and
 * trust bullets (pay-half + originality) so every message reads complete.
 */
export function promoText(
  lang: "en" | "am",
  head: string,
  subLine: string,
  body: string,
  opts: { trust?: boolean } = {},
): string {
  const trust =
    lang === "am"
      ? "✓ 100% ኦርጅናል ምርት\n✓ ግማሽ አሁን ብቻ — ቀሪው በመላኪያ"
      : "✓ 100% original\n✓ Pay half now, half on delivery";
  const parts = [`${head}\n${subLine}`, body];
  if (opts.trust !== false) parts.push(trust);
  return parts.join("\n\n");
}

/**
 * Post-process raw model output into something safe to send to a customer.
 * Returns null when the output is unusable (caller uses the template).
 * Guards: markdown/quotes/options-lists stripped, mid-sentence truncation
 * repaired at a word boundary, generic slop and links rejected.
 */
export function cleanCopy(text: string | null): string | null {
  if (!text) return null;
  let out = text.trim();
  // Strip wrapping quotes.
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1).trim();
  }
  // Drop markdown dressing and quote markers.
  out = out.replace(/^[#>]\s*/gm, "").replace(/\*\*/g, "").replace(/__([^_]+)__/g, "$1");
  // Collapse whitespace; keep at most two short paragraphs.
  out = out
    .split(/\n+/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
  // Reject multi-option dumps, subjects, links, placeholders.
  if (/^(option|subject|title)\s*\d*\s*:/i.test(out)) return null;
  if (/https?:\/\/|\[.*?\]|\(.*?\)|{[^{}]*}/.test(out)) return null;
  if (out.length < 20) return null;
  // Cap length at a word boundary so nothing goes out half-written.
  const MAX = 420;
  if (out.length > MAX) {
    const cut = out.slice(0, MAX);
    const lastSpace = cut.lastIndexOf(" ");
    out = (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trim();
  }
  // Must end finished — not a dangling fragment. A complete thought closed
  // with emoji is fine; otherwise salvage the last full sentence or give up
  // (caller sends the hand-written template instead).
  const noEmojiTail = out.replace(/[\p{Emoji}\uFE0F\u200D\s]+$/u, "");
  const strippedEmoji = noEmojiTail.length !== out.length;
  if (/[.!?…)\]"'”’]$/.test(noEmojiTail)) return out;
  if (strippedEmoji && noEmojiTail.length >= 20) return out;
  const m = out.match(/^(.*[.!?…])/s);
  if (!m?.[1]) return null;
  out = m[1].trim();
  // A salvaged complete sentence may be short ("Back tomorrow.") — accept it.
  return out.length >= 12 ? out : null;
}

async function sendPromo(
  db: Db,
  bot: Bot,
  env: AppEnv,
  target: Target,
  text: string,
  urlPath: string,
  buttonText: string,
  job: string,
  refId?: string,
  productId?: string,
  photo?: string | null,
): Promise<void> {
  const markup = {
    reply_markup: {
      inline_keyboard: [
        [{ text: buttonText, web_app: { url: `${env.WEBAPP_URL.replace(/\/$/, "")}${urlPath}` } }],
      ],
    },
  };
  // Product photos make promos look like a real shop ad, not a text bot.
  if (photo) {
    try {
      await bot.api.sendPhoto(target.telegramId, photo, {
        caption: text.slice(0, 1024),
        ...markup,
      });
    } catch {
      // Photo fetch/size failed — never lose the message over the image.
      await bot.api.sendMessage(target.telegramId, text, markup);
    }
  } else {
    await bot.api.sendMessage(target.telegramId, text, markup);
  }
  await logAgentMessage(db, target.profileId, job, refId).catch((err) =>
    console.error(`[agent] log failed for ${target.profileId}:`, err),
  );
  if (productId) {
    await logNotification(db, target.profileId, productId, job).catch(() => undefined);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Jobs
// ──────────────────────────────────────────────────────────────────────

interface JobResult {
  sent: number;
  skipped: number;
}

async function jobPriceDrops(db: Db, bot: Bot, env: AppEnv, sinceIso: string | null): Promise<JobResult> {
  const since = sinceIso ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
  const products = await discountedProducts(db, { since, limit: 10 });
  let sent = 0;
  let skipped = 0;
  for (const p of products) {
    const excluded = await recentlyNotifiedProfileIds(db, p.id, 30).catch(() => [] as string[]);
    const raw = await notifyTargetsForCategories(db, p.categoryId ? [p.categoryId] : [], excluded, 80).catch(
      () => [] as NotifyTarget[],
    );
    const targets = await cooledDown(db, await withLanguages(db, raw));
    if (targets.length === 0) {
      skipped += 1;
      continue;
    }
    const pct = p.compareAtHalala ? Math.round((1 - p.priceHalala / p.compareAtHalala) * 100) : 0;
    const en = await promoCopy(
      env,
      `Write a short cosmetics sale promo about ${p.nameEn}: open with the price-drop excitement, mention it is 100% original with fast Addis Ababa delivery, and invite them to grab it before it sells out.`,
      `This is your chance: the ${p.nameEn} just dropped to ${formatETB(p.priceHalala)} ETB. Original formula, fast delivery in Addis, and you only pay half today — the rest when it arrives.`,
    );
    for (const t of targets.slice(0, 60)) {
      const name = t.language === "am" && p.nameAm ? p.nameAm : p.nameEn;
      const head =
        t.language === "am"
          ? `${pct > 0 ? `🔥 ${pct}% ቅናሽ · ` : "✨ "}${name}`
          : `${pct > 0 ? `🔥 ${pct}% off · ` : "✨ "}${name}`;
      const body =
        t.language === "am"
          ? `ይህ ዕድል ነው። ${name} ዋጋው ወርዷል — ኦርጅናል ምርት፣ በአዲስ አበባ ፍጥነት ይደርሳል። ግማሽ አሁን ብቻ ይክፈሉ።`
          : en;
      const text = promoText(t.language, head, priceLineFor(t.language, p.priceHalala, p.compareAtHalala), body);
      try {
        await sendPromo(db, bot, env, t, text, `/product/${p.id}`, t.language === "am" ? "አሁን ይግዙ 🛒" : "Shop now 🛒", "price_drops", p.id, p.id, p.imageUrl);
        sent += 1;
      } catch (err) {
        console.error(`[agent:price_drops] send failed for ${t.telegramId}:`, err);
      }
    }
  }
  return { sent, skipped };
}

async function jobNewArrivals(db: Db, bot: Bot, env: AppEnv, sinceIso: string | null): Promise<JobResult> {
  const since = sinceIso ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("products")
    .select("id, name_en, name_am, price_halala, category_id, image_urls")
    .eq("is_active", true)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`new_arrivals: ${error.message}`);
  const products = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    nameEn: r.name_en as string,
    nameAm: (r.name_am as string) ?? "",
    priceHalala: r.price_halala as number,
    categoryId: (r.category_id as string | null) ?? null,
    imageUrl: (Array.isArray(r.image_urls) ? (r.image_urls as string[])[0] : null) ?? null,
  }));
  let sent = 0;
  let skipped = 0;
  for (const p of products) {
    const excluded = await recentlyNotifiedProfileIds(db, p.id, 30).catch(() => [] as string[]);
    const raw = await notifyTargetsForCategories(db, p.categoryId ? [p.categoryId] : [], excluded, 120).catch(
      () => [] as NotifyTarget[],
    );
    const targets = await cooledDown(db, await withLanguages(db, raw));
    if (targets.length === 0) {
      skipped += 1;
      continue;
    }
    const en = await promoCopy(
      env,
      `Announce a fresh cosmetics arrival, ${p.nameEn}, now at Sabacos in Addis Ababa. Build excitement about being first to try it; mention original products and half-now payment.`,
      `${p.nameEn} just landed at Sabacos. Fresh stock, first-come — try it before it sells through, and pay half now, half on delivery.`,
    );
    for (const t of targets.slice(0, 80)) {
      const name = t.language === "am" && p.nameAm ? p.nameAm : p.nameEn;
      const head =
        t.language === "am" ? `✨ አዲስ ደርሷል · ${name}` : `✨ Just landed · ${name}`;
      const body =
        t.language === "am"
          ? `ይህ ${name} አዲስ ወጥቷል። ከመጀመሪያው በፊት ይሞክሩት — ቅርፃው በፍጥነት ይሞላል።`
          : en;
      const text = promoText(t.language, head, priceLineFor(t.language, p.priceHalala), body);
      try {
        await sendPromo(db, bot, env, t, text, `/product/${p.id}`, t.language === "am" ? "ይመልከቱ 👀" : "Take a look 👀", "new_arrivals", p.id, p.id, p.imageUrl);
        sent += 1;
      } catch (err) {
        console.error(`[agent:new_arrivals] send failed for ${t.telegramId}:`, err);
      }
    }
  }
  return { sent, skipped };
}

async function jobRestock(db: Db, bot: Bot, env: AppEnv, sinceIso: string | null): Promise<JobResult> {
  const since = sinceIso ?? new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("products")
    .select("id, name_en, name_am, price_halala, image_urls")
    .eq("is_active", true)
    .gt("stock", 0)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (error) throw new Error(`restock: ${error.message}`);
  const products = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    nameEn: r.name_en as string,
    nameAm: (r.name_am as string) ?? "",
    priceHalala: r.price_halala as number,
    imageUrl: (Array.isArray(r.image_urls) ? (r.image_urls as string[])[0] : null) ?? null,
  }));
  let sent = 0;
  let skipped = 0;
  for (const p of products) {
    // Viewers of THIS product who haven't heard about it in 30 days.
    const { data: views } = await db
      .from("product_views")
      .select("profile_id")
      .eq("product_id", p.id)
      .gte("created_at", new Date(Date.now() - 60 * 86_400_000).toISOString())
      .limit(300);
    const ids = [...new Set(((views ?? []) as Array<{ profile_id: string }>).map((v) => v.profile_id))];
    if (ids.length === 0) {
      skipped += 1;
      continue;
    }
    const excluded = await recentlyNotifiedProfileIds(db, p.id, 30).catch(() => [] as string[]);
    const { notifyTargetsForProfileIds } = await import("../db/marketing.js");
    const raw = await notifyTargetsForProfileIds(db, ids, excluded).catch(() => [] as NotifyTarget[]);
    const targets = await cooledDown(db, await withLanguages(db, raw));
    if (targets.length === 0) {
      skipped += 1;
      continue;
    }
    const en = await promoCopy(
      env,
      `A shopper previously viewed ${p.nameEn} and it is now back in stock at Sabacos. Friendly urgency — it sells out fast — invite them to grab it today.`,
      `Good news: the ${p.nameEn} you viewed is back in stock. It moves fast, so grab yours while it lasts — pay half now, half on delivery.`,
    );
    for (const t of targets.slice(0, 60)) {
      const name = t.language === "am" && p.nameAm ? p.nameAm : p.nameEn;
      const head =
        t.language === "am" ? `📦 እንደገና ገብቷል · ${name}` : `📦 Back in stock · ${name}`;
      const body =
        t.language === "am"
          ? `የእርስዎ ተወዳጅ ${name} እንደገና ተመልቷል። በፍጥነት ያልቃል — አሁን ያስወስዱ።`
          : en;
      const text = promoText(t.language, head, priceLineFor(t.language, p.priceHalala), body);
      try {
        await sendPromo(db, bot, env, t, text, `/product/${p.id}`, t.language === "am" ? "አሁን ይግዙ 🛒" : "Grab it 🛒", "restock", p.id, p.id, p.imageUrl);
        sent += 1;
      } catch (err) {
        console.error(`[agent:restock] send failed for ${t.telegramId}:`, err);
      }
    }
  }
  return { sent, skipped };
}

interface CartProduct {
  name_en: string;
  name_am: string | null;
  image_urls: string[] | null;
}

interface CartRow {
  profile_id: string;
  qty: number;
  product_id: string;
  // PostgREST may type the to-one FK join as either object or 1-length array.
  products: CartProduct | CartProduct[] | null;
}

function cartProductOf(row: CartRow): CartProduct | null {
  if (Array.isArray(row.products)) return row.products[0] ?? null;
  return row.products;
}

async function jobAbandonedCart(db: Db, bot: Bot, env: AppEnv): Promise<JobResult> {
  const cutoff = new Date(Date.now() - 4 * 3_600_000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: rows, error } = await db
    .from("cart_items")
    .select("profile_id, qty, updated_at, product_id, products(name_en, name_am, image_urls)")
    .lt("updated_at", cutoff)
    .limit(400);
  if (error) throw new Error(`abandoned_cart: ${error.message}`);
  const byProfile = new Map<string, { count: number; firstName: string | null; photo: string | null }>();
  for (const r of ((rows ?? []) as CartRow[])) {
    const cur = byProfile.get(r.profile_id) ?? { count: 0, firstName: null, photo: null };
    cur.count += r.qty ?? 0;
    // First item with a photo becomes the message thumbnail.
    const prod = cartProductOf(r);
    if (!cur.firstName && prod?.name_en) cur.firstName = prod.name_am || prod.name_en;
    const imgs = prod?.image_urls;
    if (!cur.photo && Array.isArray(imgs) && imgs[0]) cur.photo = imgs[0];
    byProfile.set(r.profile_id, cur);
  }
  let sent = 0;
  let skipped = 0;
  for (const [profileId, cart] of [...byProfile.entries()].slice(0, 50)) {
    const itemCount = cart.count;
    // Ordered in the last 24h? Then the cart is stale, not abandoned.
    const { data: recent } = await db
      .from("orders")
      .select("id")
      .eq("profile_id", profileId)
      .gte("created_at", dayAgo)
      .limit(1);
    if (((recent ?? []) as unknown[]).length > 0) {
      skipped += 1;
      continue;
    }
    const { data: prof } = await db
      .from("profiles")
      .select("id, telegram_id, language")
      .eq("id", profileId)
      .not("telegram_id", "is", null)
      .maybeSingle();
    const p = prof as { id: string; telegram_id: string; language?: string | null } | null;
    if (!p) {
      skipped += 1;
      continue;
    }
    const target: Target = {
      profileId: p.id,
      telegramId: p.telegram_id,
      language: p.language === "am" ? "am" : "en",
    };
    if ((await cooledDown(db, [target], 7)).length === 0) {
      skipped += 1;
      continue;
    }
    const en = await promoCopy(
      env,
      `A cosmetics shopper left ${itemCount} item(s) in their cart at Sabacos. Warm reminder: checkout takes a minute, half now and half on delivery. No guilt-tripping.`,
      `Still thinking it over? Your cart is saved and waiting — checkout takes a minute, and you only pay half now, half when it arrives.`,
    );
    const text =
      target.language === "am"
        ? promoText(
            "am",
            "🛒 ጋሪሽይጠብቃል",
            cart.firstName
              ? `${itemCount} ዕቃ · ${cart.firstName}`
              : `${itemCount} ዕቃ በጋሪሽ`,
            `ግዢዎ እየጠበቀነው። መክፈል ደቂቃዎች ብቻ ይወስዳል — ግማሽ አሁን ብቻ፣ ቀሪው ሲደርስ።`,
          )
        : promoText(
            "en",
            "🛒 Your cart is waiting",
            cart.firstName
              ? `${itemCount} item${itemCount === 1 ? "" : "s"} · ${cart.firstName}`
              : `${itemCount} item${itemCount === 1 ? "" : "s"} in your cart`,
            en,
          );
    try {
      await sendPromo(db, bot, env, target, text, "/cart", target.language === "am" ? "ጋሪን ክፈት 🛒" : "Open cart 🛒", "abandoned_cart", profileId, undefined, cart.photo);
      // 7-day per-user cooldown marker lives in the agent log itself.
      sent += 1;
    } catch (err) {
      console.error(`[agent:abandoned_cart] send failed for ${target.telegramId}:`, err);
    }
  }
  return { sent, skipped };
}

async function jobWinback(db: Db, bot: Bot, env: AppEnv): Promise<JobResult> {
  const ago90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const ago30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: rows, error } = await db
    .from("orders")
    .select("profile_id, created_at")
    .neq("status", "cancelled")
    .gte("created_at", ago90)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`winback: ${error.message}`);
  const lastOrder = new Map<string, string>();
  for (const r of ((rows ?? []) as Array<{ profile_id: string; created_at: string }>)) {
    if (!lastOrder.has(r.profile_id)) lastOrder.set(r.profile_id, r.created_at);
  }
  const dormant = [...lastOrder.entries()].filter(([, ts]) => ts < ago30).slice(0, 100);
  let sent = 0;
  let skipped = 0;
  for (const [profileId] of dormant) {
    const { data: prof } = await db
      .from("profiles")
      .select("id, telegram_id, language, first_name")
      .eq("id", profileId)
      .not("telegram_id", "is", null)
      .maybeSingle();
    const p = prof as { id: string; telegram_id: string; language?: string | null; first_name?: string | null } | null;
    if (!p) {
      skipped += 1;
      continue;
    }
    const target: Target = {
      profileId: p.id,
      telegramId: p.telegram_id,
      language: p.language === "am" ? "am" : "en",
    };
    if ((await cooledDown(db, [target], 30)).length === 0) {
      skipped += 1;
      continue;
    }
    const en = await promoCopy(
      env,
      `Win back a cosmetics customer who has not ordered in 30+ days from Sabacos. Mention the fresh new arrivals and that referring friends earns prize-wheel spins. Warm and inviting, no discounts promised.`,
      `It has been a while. Fresh arrivals just dropped at Sabacos, and every friend you refer earns prize-wheel spins. Come see what is new.`,
    );
    const text =
      target.language === "am"
        ? promoText(
            "am",
            "💛 ሳባኮስ ናፍቆሻል!",
            "አዲስ ምርቶች ·የማሽከርከር ዕድል",
            `በ30 ቀን በላይ አይተዉንም። አዲስ ምርቶች ገብተዋል — ሪፈራልሽም የማሽከርከር ዕድል ያስገኛል። ተመልሰው ይመልከቱ።`,
          )
        : promoText("en", "💛 We miss you at Sabacos!", "New arrivals · spins to win", en);
    try {
      await sendPromo(db, bot, env, target, text, "/shop", target.language === "am" ? "ሱቁን ክፈት ✨" : "Come back ✨", "winback", profileId);
      sent += 1;
    } catch (err) {
      console.error(`[agent:winback] send failed for ${target.telegramId}:`, err);
    }
  }
  return { sent, skipped };
}

async function jobReferralNudge(db: Db, bot: Bot, env: AppEnv): Promise<JobResult> {
  // Pending referees from roughly the last month — older ones are stale.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: rows, error } = await db
    .from("referrals")
    .select("referrer_id")
    .eq("status", "pending")
    .gte("created_at", since)
    .limit(500);
  if (error) throw new Error(`referral_nudge: ${error.message}`);
  const counts = new Map<string, number>();
  for (const r of ((rows ?? []) as Array<{ referrer_id: string }>)) {
    counts.set(r.referrer_id, (counts.get(r.referrer_id) ?? 0) + 1);
  }
  let sent = 0;
  let skipped = 0;
  for (const [referrerId, n] of [...counts.entries()].slice(0, 60)) {
    const { data: prof } = await db
      .from("profiles")
      .select("id, telegram_id, language")
      .eq("id", referrerId)
      .not("telegram_id", "is", null)
      .maybeSingle();
    const p = prof as { id: string; telegram_id: string; language?: string | null } | null;
    if (!p) {
      skipped += 1;
      continue;
    }
    const target: Target = {
      profileId: p.id,
      telegramId: p.telegram_id,
      language: p.language === "am" ? "am" : "en",
    };
    if ((await cooledDown(db, [target], 7)).length === 0) {
      skipped += 1;
      continue;
    }
    const en = await promoCopy(
      env,
      `Nudge a referrer: ${n} friend(s) joined via their Sabacos link but have not ordered yet. A quick reminder can turn each into 10% commission for them. Motivating, not pushy.`,
      `Your friends joined with your link but have not ordered yet. A quick reminder can turn each into 10% commission for you — check your referrals and nudge them.`,
    );
    const text =
      target.language === "am"
        ? promoText(
            "am",
            "📣 ሪፈራል ማስታወሻ",
            `${n} ጓደኛ${n === 1 ? "" : "ና"} ገና አልዘዙም`,
            `በሊንክሽ ተቀላቅለው ግን አልዘዙም። አስታውሸው — በየትዕዛዙ 10% ታገኛለሽ።`,
            { trust: false },
          )
        : promoText(
            "en",
            "📣 Referral reminder",
            `${n} friend${n === 1 ? "" : "s"} pending an order`,
            en,
            { trust: false },
          );
    try {
      await sendPromo(db, bot, env, target, text, "/referral", target.language === "am" ? "ሪፈራሎቼ 🎁" : "My referrals 🎁", "referral_nudge", referrerId);
      sent += 1;
    } catch (err) {
      console.error(`[agent:referral_nudge] send failed for ${target.telegramId}:`, err);
    }
  }
  return { sent, skipped };
}

// ──────────────────────────────────────────────────────────────────────
// Scheduler
// ──────────────────────────────────────────────────────────────────────

interface JobDef {
  key: string;
  intervalMs: number;
  run: (db: Db, bot: Bot, env: AppEnv, cursor: string | null) => Promise<JobResult>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const JOBS: JobDef[] = [
  { key: "price_drops", intervalMs: DAY, run: (db, bot, env, c) => jobPriceDrops(db, bot, env, c) },
  { key: "new_arrivals", intervalMs: DAY, run: (db, bot, env, c) => jobNewArrivals(db, bot, env, c) },
  { key: "restock", intervalMs: DAY, run: (db, bot, env, c) => jobRestock(db, bot, env, c) },
  { key: "abandoned_cart", intervalMs: 6 * HOUR, run: (db, bot, env) => jobAbandonedCart(db, bot, env) },
  { key: "winback", intervalMs: 7 * DAY, run: (db, bot, env) => jobWinback(db, bot, env) },
  { key: "referral_nudge", intervalMs: 7 * DAY, run: (db, bot, env) => jobReferralNudge(db, bot, env) },
];

export async function runMarketingAgent(
  db: Db,
  bot: Bot,
  env: AppEnv,
  now: Date = new Date(),
): Promise<Record<string, JobResult>> {
  if ((env.MARKETING_AGENT ?? "on") === "off") return {};
  if (isQuietHours(now)) {
    log.info("Marketing agent: quiet hours, skipping pass");
    return {};
  }
  const out: Record<string, JobResult> = {};
  for (const job of JOBS) {
    let cursor: string | null = null;
    try {
      cursor = await getAgentJobCursor(db, job.key);
    } catch { /* first run */ }
    if (!jobDue(cursor, job.intervalMs, now.getTime())) continue;
    try {
      out[job.key] = await job.run(db, bot, env, cursor);
      log.info(`Marketing agent [${job.key}]: ${JSON.stringify(out[job.key])}`);
    } catch (err) {
      console.error(`[agent:${job.key}] failed:`, err);
      out[job.key] = { sent: 0, skipped: 0 };
    }
    try {
      await setAgentJobCursor(db, job.key, now.toISOString());
    } catch { /* non-fatal */ }
  }
  return out;
}

let agentInterval: ReturnType<typeof setInterval> | null = null;
let agentTimeout: ReturnType<typeof setTimeout> | null = null;

/** Hourly ticks (first after 2 min); each job enforces its own cadence. */
export function startMarketingAgent(bot: Bot, env: AppEnv): void {
  if ((env.MARKETING_AGENT ?? "on") === "off") return;
  const db = getDb(env);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runMarketingAgent(db, bot, env);
    } catch (err) {
      console.error("[agent] pass failed:", err);
    } finally {
      running = false;
    }
  };
  agentTimeout = setTimeout(tick, 120_000);
  agentInterval = setInterval(tick, 3_600_000);
}

export function stopMarketingAgent(): void {
  if (agentTimeout) {
    clearTimeout(agentTimeout);
    agentTimeout = null;
  }
  if (agentInterval) {
    clearInterval(agentInterval);
    agentInterval = null;
  }
}
