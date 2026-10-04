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
  type DiscountCandidate,
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

/** Gemini EN line with template fallback; Amharic always from template. */
async function promoCopy(
  env: AppEnv,
  prompt: string,
  fallbackEn: string,
): Promise<string> {
  try {
    const text = await geminiText(
      env,
      `${prompt}\nRules: max 40 words, plain text, one emoji max, no links, no hashtags, no prices you were not given.`,
      { maxOutputTokens: 120, timeoutMs: 20_000 },
    );
    if (text) return text.slice(0, 500);
  } catch { /* fall through */ }
  return fallbackEn;
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
): Promise<void> {
  await bot.api.sendMessage(target.telegramId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: buttonText, web_app: { url: `${env.WEBAPP_URL.replace(/\/$/, "")}${urlPath}` } }],
      ],
    },
  });
  await logAgentMessage(db, target.profileId, job, refId).catch((err) =>
    console.error(`[agent] log failed for ${target.profileId}:`, err),
  );
  if (productId) {
    await logNotification(db, target.profileId, productId, job).catch(() => undefined);
  }
}

function productLine(p: DiscountCandidate): string {
  return `${p.nameEn} — ${formatETB(p.priceHalala)}`;
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
      `Write a short promo for a cosmetics sale: ${productLine(p)}${pct > 0 ? `, ${pct}% off` : ""}. Beauty shop in Addis Ababa, pay half now.`,
      `🔥 ${pct > 0 ? `${pct}% off! ` : ""}${p.nameEn} now ${formatETB(p.priceHalala)} at Sabacos — 100% original, pay half now.`,
    );
    for (const t of targets.slice(0, 60)) {
      const text = t.language === "am" ? `🔥 ቅናሽ! ${p.nameAm || p.nameEn} አሁን ${formatETB(p.priceHalala)} — ሳባኮስ, 100% ኦርጅናል, ግማሽ አሁን።` : en;
      try {
        await sendPromo(db, bot, env, t, text, `/product/${p.id}`, t.language === "am" ? "አሁን ይግዙ 🛒" : "Shop now 🛒", "price_drops", p.id, p.id);
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
    .select("id, name_en, name_am, price_halala, category_id")
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
      `Announce a new arrival at a cosmetics shop in Addis Ababa: ${p.nameEn}, ${formatETB(p.priceHalala)}. Invite them to be first to try it.`,
      `✨ New in at Sabacos: ${p.nameEn} (${formatETB(p.priceHalala)}). Be first to try it — 100% original.`,
    );
    for (const t of targets.slice(0, 80)) {
      const text = t.language === "am" ? `✨ አዲስ በሳባኮስ: ${p.nameAm || p.nameEn} (${formatETB(p.priceHalala)}). አስቀድመው ይሞክሩት።` : en;
      try {
        await sendPromo(db, bot, env, t, text, `/product/${p.id}`, t.language === "am" ? "ይመልከቱ 👀" : "Take a look 👀", "new_arrivals", p.id, p.id);
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
    .select("id, name_en, name_am, price_halala")
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
      `Tell a shopper their viewed item is back in stock: ${p.nameEn}, ${formatETB(p.priceHalala)}. Urgent but friendly, it sells out fast.`,
      `📦 Back in stock: ${p.nameEn} (${formatETB(p.priceHalala)}). It sells out fast — grab yours at Sabacos.`,
    );
    for (const t of targets.slice(0, 60)) {
      const text = t.language === "am" ? `📦 እንደገና ገብቷል: ${p.nameAm || p.nameEn} (${formatETB(p.priceHalala)}). በፍጥነት ያልቃል — ዛሬ ይዘዙ።` : en;
      try {
        await sendPromo(db, bot, env, t, text, `/product/${p.id}`, t.language === "am" ? "አሁን ይግዙ 🛒" : "Grab it 🛒", "restock", p.id, p.id);
        sent += 1;
      } catch (err) {
        console.error(`[agent:restock] send failed for ${t.telegramId}:`, err);
      }
    }
  }
  return { sent, skipped };
}

async function jobAbandonedCart(db: Db, bot: Bot, env: AppEnv): Promise<JobResult> {
  const cutoff = new Date(Date.now() - 4 * 3_600_000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: rows, error } = await db
    .from("cart_items")
    .select("profile_id, qty, updated_at")
    .lt("updated_at", cutoff)
    .limit(400);
  if (error) throw new Error(`abandoned_cart: ${error.message}`);
  const byProfile = new Map<string, number>();
  for (const r of ((rows ?? []) as Array<{ profile_id: string; qty: number }>)) {
    byProfile.set(r.profile_id, (byProfile.get(r.profile_id) ?? 0) + (r.qty ?? 0));
  }
  let sent = 0;
  let skipped = 0;
  for (const [profileId, itemCount] of [...byProfile.entries()].slice(0, 50)) {
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
      `Remind a shopper they left ${itemCount} item(s) in their cart at a cosmetics shop. Mention they can pay half now, half on delivery. Warm, short, no guilt-tripping.`,
      `🛒 Your cart misses you (${itemCount} item${itemCount === 1 ? "" : "s"} waiting). Checkout takes a minute — and you only pay half now at Sabacos.`,
    );
    const text =
      target.language === "am"
        ? `🛒 ጋሪሽን ረስተዋል (${itemCount} ዕቃ ይጠብቃል)። መክፈል ግማሽ አሁን ብቻ — ሳባኮስ።`
        : en;
    try {
      await sendPromo(db, bot, env, target, text, "/cart", target.language === "am" ? "ጋሪን ክፈት 🛒" : "Open cart 🛒", "abandoned_cart", profileId);
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
      `Win back a cosmetics customer absent 30+ days. Mention new arrivals and the prize wheel (spins for referrals). Warm, no discounts promised.`,
      `💛 We miss you at Sabacos! New arrivals landed, and your referrals can win you prize-wheel spins. Come take a look.`,
    );
    const text =
      target.language === "am"
        ? `💛 ሳባኮስ ናፍቆሻል! አዳዲስ ምርቶች ገብተዋል — ሪፈራልሽ የማሽከርከር ዕድሎችን ያስገኛል።`
        : en;
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
      `Nudge a referrer: ${n} friend(s) joined via their link but haven't ordered yet. Tell them a reminder earns 10% commission per order. Short and motivating.`,
      `📣 ${n} friend${n === 1 ? "" : "s"} joined with your link but ${n === 1 ? "hasn't" : "haven't"} ordered yet — send a reminder and earn 10% on every order!`,
    );
    const text =
      target.language === "am"
        ? `📣 ${n} ጓደኛ በሊንክሽ ተቀላቅሏል ግን ገና አላዘዘም — አስታውሽ, በየትዕዛዙ 10% ታገኛለሽ!`
        : en;
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
