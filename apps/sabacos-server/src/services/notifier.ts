import type { Bot } from "grammy";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { getDb, type Db } from "../db/client.js";
import {
  discountedProducts,
  getJobState,
  logNotification,
  notifyTargetsForCategories,
  notifyTargetsForProfileIds,
  recentlyNotifiedProfileIds,
  setJobState,
  type DiscountCandidate,
} from "../db/marketing.js";
import { discountPct } from "./ads.js";
import { aiEnabled, llamaNotifyText } from "./ai.js";
import { queryMatchingProfiles, vectorEnabled } from "./vector.js";

const STATE_KEY = "marketing_sweep";

const SweepState = z.object({ lastRun: z.string().datetime() });

function formatHalala(halala: number): string {
  return (halala / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function discountMessage(
  product: DiscountCandidate,
  langHint: "en" | "am" = "en",
): { text: string; urlPath: string } {
  const name = langHint === "am" && product.nameAm ? product.nameAm : product.nameEn;
  const pct = discountPct(product);
  const price = formatHalala(product.priceHalala);
  const old = product.compareAtHalala != null ? formatHalala(product.compareAtHalala) : null;
  const head =
    langHint === "am"
      ? `${pct != null ? `🔥 ${pct}% ቅናሽ! ` : "✨ "}${name}`
      : `${pct != null ? `🔥 ${pct}% off! ` : "✨ "}${name}`;
  const priceLine =
    old != null
      ? langHint === "am"
        ? `${price} ETB · ነበር ${old} ETB`
        : `${price} ETB · was ${old} ETB`
      : `${price} ETB`;
  return {
    text: `${head}\n${priceLine}\n\n🛍️ Sabacos`,
    urlPath: `/product/${product.id}`,
  };
}

/** AI-drafted notification text, cached per product for 24h. */
async function notifyText(
  db: Db,
  env: AppEnv,
  product: DiscountCandidate,
): Promise<{ text: string; ai: boolean }> {
  const key = `notify:${product.id}:${discountPct(product) ?? 0}`;
  const { data } = await db
    .from("ad_copy_cache")
    .select("payload")
    .eq("cache_key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (data?.payload != null) return { text: (data.payload as { text: string }).text, ai: true };

  const fallback = discountMessage(product);
  let text = fallback.text;
  if (aiEnabled(env)) {
    const ai = await llamaNotifyText(
      env,
      {
        name: product.nameEn,
        priceEtb: formatHalala(product.priceHalala),
        oldPriceEtb:
          product.compareAtHalala != null ? formatHalala(product.compareAtHalala) : undefined,
        discountPct: discountPct(product),
      },
      "cosmetics and beauty products they browsed in our shop",
      "en",
    );
    if (ai) text = ai;
  }
  await db
    .from("ad_copy_cache")
    .upsert(
      { cache_key: key, payload: { text }, expires_at: new Date(Date.now() + 86_400_000).toISOString() },
      { onConflict: "cache_key" },
    );
  return { text, ai: aiEnabled(env) };
}

/**
 * Hourly sweep: find products whose discount is new since the last run.
 * Targets come from Vectorize taste-vector similarity when available,
 * falling back to category viewers. One notification per product per
 * profile per 30 days.
 */
export async function runMarketingSweep(db: Db, bot: Bot, env: AppEnv): Promise<number> {
  const raw = await getJobState(db, STATE_KEY);
  const state = SweepState.safeParse(raw);
  const since = state.success
    ? state.data.lastRun
    : new Date(Date.now() - 24 * 86_400_000).toISOString();

  const fresh = await discountedProducts(db, { since, limit: 10 });
  let sent = 0;

  for (const product of fresh) {
    const excluded = await recentlyNotifiedProfileIds(db, product.id);

    let targets: Awaited<ReturnType<typeof notifyTargetsForCategories>> = [];
    if (vectorEnabled(env)) {
      const matchedIds = await queryMatchingProfiles(
        env,
        `${product.nameEn} — cosmetics, beauty, skincare`,
        60,
      ).catch(() => []);
      if (matchedIds.length > 0) {
        targets = await notifyTargetsForProfileIds(db, matchedIds, excluded);
      }
    }
    if (targets.length === 0 && product.categoryId) {
      targets = await notifyTargetsForCategories(db, [product.categoryId], excluded, 100);
    }

    if (targets.length === 0) continue;
    const { text } = await notifyText(db, env, product);
    const urlPath = `/product/${product.id}`;

    for (const target of targets.slice(0, 100)) {
      try {
        await bot.api.sendMessage(target.telegramId, text, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Shop now 🛒", web_app: { url: `${env.WEBAPP_URL.replace(/\/$/, "")}${urlPath}` } }],
            ],
          },
        });
        await logNotification(db, target.profileId, product.id);
        sent += 1;
      } catch (err) {
        console.error(`[marketing] send failed for ${target.telegramId}:`, err);
      }
    }
  }

  await setJobState(db, STATE_KEY, { lastRun: new Date().toISOString() });
  return sent;
}

/** Starts the hourly sweep loop. No-op when MARKETING_SWEEP=off. */
export function startMarketingSweeper(bot: Bot, env: AppEnv): void {
  if ((env.MARKETING_SWEEP ?? "on") === "off") return;
  const db = getDb(env);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await runMarketingSweep(db, bot, env);
      if (sent > 0) console.log(`[marketing] sweep sent ${sent} notifications`);
    } catch (err) {
      console.error("[marketing] sweep failed:", err);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 60_000);
  setInterval(tick, 3_600_000);
}
