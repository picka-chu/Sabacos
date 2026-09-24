import { InlineKeyboard } from "grammy";

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
