import { InlineKeyboard } from "grammy";
import type { AppEnv } from "../env.js";
import type { Db } from "../db/client.js";
import { createBot } from "../bot/bot.js";

export interface BroadcastButtonInput {
  buttonText?: string | undefined;
  buttonUrl?: string | undefined;
  buttonInline?: boolean | undefined;
  buttonTarget?: string | undefined;
}

/** Normalize an in-app path to a leading-slash route (e.g. "shop" → "/shop"). */
export function normalizeAppPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Absolute mini-app URL for an in-app route path. */
export function appRouteUrl(webappUrl: string, path: string): string {
  const base = webappUrl.replace(/\/$/, "");
  return `${base}${normalizeAppPath(path)}`;
}

/**
 * Build the Telegram reply_markup for a broadcast.
 * - Inline + target → `web_app` button (opens Sabacos mini app at that route).
 * - External URL    → plain `url` button (opens outside Telegram).
 * - Incomplete input → no button.
 */
export function buildBroadcastKeyboard(
  webappUrl: string,
  input: BroadcastButtonInput,
): InlineKeyboard | undefined {
  const label = input.buttonText?.trim();
  if (!label) return undefined;

  if (input.buttonInline) {
    const path = normalizeAppPath(input.buttonTarget ?? "");
    if (!path) return undefined;
    return new InlineKeyboard().webApp(label, appRouteUrl(webappUrl, path));
  }

  const url = input.buttonUrl?.trim();
  if (!url) return undefined;
  return new InlineKeyboard().url(label, url);
}

export interface BroadcastSendInput extends BroadcastButtonInput {
  text: string;
  imageUrl?: string | undefined;
}

export interface BroadcastSendResult {
  sent: number;
  failed: number;
  failedSamples: string[];
}

/**
 * Fan-out sender shared by the admin Broadcast page and the AI agent.
 * Pages profiles in chunks; one blocked user never kills the batch.
 */
export async function executeBroadcast(
  db: Db,
  env: AppEnv,
  input: BroadcastSendInput,
): Promise<BroadcastSendResult> {
  const bot = createBot(env);
  const replyMarkup = buildBroadcastKeyboard(env.WEBAPP_URL, input);

  let sent = 0;
  let failed = 0;
  const failedSamples: string[] = [];
  const PAGE = 200;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("profiles")
      .select("telegram_id")
      .not("telegram_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`broadcast fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      try {
        if (input.imageUrl) {
          await bot.api.sendPhoto(row.telegram_id as string, input.imageUrl, {
            caption: input.text.slice(0, 1024),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          });
        } else {
          await bot.api.sendMessage(row.telegram_id as string, input.text, {
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          });
        }
        sent += 1;
      } catch (err) {
        failed += 1;
        if (failedSamples.length < 5) {
          failedSamples.push(err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200));
        }
      }
      // Stay well under Telegram's ~30 msg/sec global limit.
      await new Promise((r) => setTimeout(r, 50));
    }
    if (data.length < PAGE) break;
  }
  if (failedSamples.length > 0) {
    console.error(`[broadcast] ${failed} failed. Samples: ${failedSamples.join(" | ")}`);
  }
  return { sent, failed, failedSamples };
}
