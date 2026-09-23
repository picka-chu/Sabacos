/**
 * Product-share click attribution (Track 2).
 *
 * Packed link payloads look like `s<telegramId>_<uuid-without-dashes>`
 * (~44 chars, inside Telegram's 64-char startapp limit). On open we stamp
 * the click to localStorage (last-click wins); checkout sends it back and
 * the server validates everything (sharer exists, not self, 7-day window).
 */

export interface ShareClick {
  sharerTelegramId: number;
  productId: string;
  ts: number;
}

const STAMP_KEY = "sabacos:share_click";
const CONSUMED_KEY = "sabacos:share_click:consumed";

export const SHARE_ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Mirror of the server's parseSharePayload (kept in sync manually). */
export function parseSharePayload(
  raw: string,
): { sharerTelegramId: number; productId: string } | null {
  const m = /^s(\d{5,12})_([0-9a-fA-F]{32})$/.exec(raw.trim());
  if (!m || !m[1] || !m[2]) return null;
  const hex = m[2].toLowerCase();
  return {
    sharerTelegramId: Number(m[1]),
    productId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  };
}

export function stampShareClick(click: ShareClick): void {
  try {
    localStorage.setItem(STAMP_KEY, JSON.stringify(click));
    sessionStorage.removeItem(CONSUMED_KEY);
  } catch {
    /* storage unavailable — attribution skipped */
  }
}

/** Fresh stamp for checkout (null when absent or outside the window). */
export function readShareClick(): ShareClick | null {
  try {
    const raw = localStorage.getItem(STAMP_KEY);
    if (!raw) return null;
    const click = JSON.parse(raw) as ShareClick;
    if (
      typeof click.sharerTelegramId !== "number" ||
      typeof click.ts !== "number" ||
      Date.now() - click.ts > SHARE_ATTRIBUTION_WINDOW_MS ||
      click.ts > Date.now() + 60_000
    ) {
      return null;
    }
    return click;
  } catch {
    return null;
  }
}

/** One-per-session guard so /referral/attribute fires exactly once per click. */
export function consumeShareClick(): ShareClick | null {
  try {
    if (sessionStorage.getItem(CONSUMED_KEY) === "1") return null;
    const click = readShareClick();
    if (!click) return null;
    sessionStorage.setItem(CONSUMED_KEY, "1");
    return click;
  } catch {
    return null;
  }
}
