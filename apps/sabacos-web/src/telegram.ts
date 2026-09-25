export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
      photo_url?: string;
    };
    auth_date?: number;
    query_id?: string;
  };
  startParam?: string;
  colorScheme: "light" | "dark";
  themeParams: {
    bg_color?: string;
    secondary_bg_color?: string;
    header_bg_color?: string;
    text_color?: string;
    hint_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  sendData?: (data: string) => void;
  openLink: (url: string) => void;
  openTelegramLink?: (url: string) => void;
  shareMessage?: (msg_id: string, callback?: (sent: boolean) => void) => void;
  openInvoice?: (url: string) => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  enableClosingConfirmation: () => void;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    setText: (text: string) => void;
    setParams: (params: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    hide: () => void;
    show: () => void;
    enable: () => void;
    disable: () => void;
  };
  BackButton?: {
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    show: () => void;
    hide: () => void;
  };
  onEvent: (eventType: string, callback: (data?: unknown) => void) => void;
  offEvent?: (eventType: string, callback: (data?: unknown) => void) => void;
  requestPhone?: () => void;
  requestLocation?: () => void;
  HapticFeedback: {
    impactOccurred: (style: string) => void;
    notificationOccurred: (type: string) => void;
  };
  version: string;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

const APP_VARS = [
  "--bg",
  "--surface",
  "--surface-2",
  "--ink",
  "--muted",
  "--accent",
  "--accent-strong",
  "--accent-soft",
  "--accent-glow",
  "--on-accent",
];

function isHex(v: string | undefined): v is string {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

export function applyTelegramTheme(): void {
  const root = document.documentElement;
  const webApp = getTelegramWebApp();
  if (!webApp) return;

  const p = webApp.themeParams;
  const colorScheme = webApp.colorScheme ?? "light";

  root.dataset.theme = colorScheme;

  if (p.bg_color) root.style.setProperty("--tg-bg", p.bg_color);
  if (p.secondary_bg_color) root.style.setProperty("--tg-secondary-bg", p.secondary_bg_color);
  if (p.text_color) root.style.setProperty("--tg-text", p.text_color);
  if (p.hint_color) root.style.setProperty("--tg-hint", p.hint_color);
  if (p.button_color) root.style.setProperty("--tg-button", p.button_color);
  if (p.button_text_color) root.style.setProperty("--tg-button-text", p.button_text_color);

  if (colorScheme === "dark") {
    // Follow Telegram's dark palette for backgrounds and text only;
    // brand pink stays on buttons, chips and active indicators.
    const bg = isHex(p.bg_color) ? p.bg_color : "#1c1c1e";
    const surface = isHex(p.secondary_bg_color) ? p.secondary_bg_color : "#2c2c2e";
    const surface2 = isHex(p.header_bg_color)
      ? p.header_bg_color
      : isHex(p.secondary_bg_color)
        ? p.secondary_bg_color
        : "#3a3a3c";
    const ink = isHex(p.text_color) ? p.text_color : "#f2f2f7";
    const hint = isHex(p.hint_color) ? p.hint_color : "#98989f";

    const vars: Record<string, string> = {
      "--bg": bg,
      "--surface": surface,
      "--surface-2": surface2,
      "--ink": ink,
      "--muted": hint,
    };
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
  } else {
    // Light mode: white app background with the brand palette from CSS.
    for (const v of APP_VARS) root.style.removeProperty(v);
  }

  try {
    const headerColor =
      colorScheme === "dark"
        ? p.secondary_bg_color ?? p.bg_color ?? "#1c1c1e"
        : p.bg_color ?? "#ffffff";
    webApp.setHeaderColor?.(headerColor);
    webApp.setBackgroundColor?.(colorScheme === "dark" ? p.bg_color ?? "#1c1c1e" : "#ffffff");
  } catch {
    /* older clients */
  }

  try {
    webApp.ready();
    webApp.expand();
  } catch {
    /* noop */
  }
}

export function haptic(style: "light" | "medium" | "heavy" = "light"): void {
  try {
    getTelegramWebApp()?.HapticFeedback.impactOccurred(style);
  } catch {
    /* noop */
  }
}

/**
 * True when running inside a Telegram client (any launch entry: menu button,
 * keyboard button, inline, direct startapp link). Object presence alone
 * counts — Telegram always injects window.Telegram.WebApp, while initData
 * can lag a beat behind on slower clients.
 */
export function isTelegramClient(): boolean {
  try {
    const w = window as unknown as { Telegram?: { WebApp?: { version?: unknown } } };
    return typeof w.Telegram?.WebApp?.version === "string";
  } catch {
    return false;
  }
}

/**
 * Snapshot of the URL at module load. Telegram's SDK may later strip the
 * tgWebApp* params via history.replaceState — keep the originals so auth
 * still works after reloads and on clients that clean the address bar.
 */
const LAUNCH_URL = (() => {
  try {
    return { search: window.location.search, hash: window.location.hash };
  } catch {
    return { search: "", hash: "" };
  }
})();

/** Session initData cache — valid well within the server's 24h window;
 *  lets reloads authenticate even when the launch params were stripped. */
const INIT_DATA_CACHE_KEY = "sabacos:initData";
const INIT_DATA_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readInitDataFrom(search: string, hash: string): string {
  const fromHash = /tgWebAppData=([^&]*)/.exec(hash);
  if (fromHash?.[1]) {
    try {
      return decodeURIComponent(fromHash[1]);
    } catch {
      /* fall through */
    }
  }
  try {
    const fromSearch = new URLSearchParams(search).get("tgWebAppData");
    if (fromSearch) return fromSearch;
  } catch {
    /* noop */
  }
  return "";
}

function cacheInitData(data: string): void {
  try {
    sessionStorage.setItem(INIT_DATA_CACHE_KEY, JSON.stringify({ d: data, t: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

function readCachedInitData(): string {
  try {
    const raw = sessionStorage.getItem(INIT_DATA_CACHE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { d?: unknown; t?: unknown };
    if (
      typeof parsed.d === "string" &&
      parsed.d.length > 0 &&
      typeof parsed.t === "number" &&
      Date.now() - parsed.t < INIT_DATA_CACHE_MAX_AGE_MS
    ) {
      return parsed.d;
    }
  } catch {
    /* corrupt cache */
  }
  return "";
}

export function hasLaunchParams(): boolean {
  const sources = [
    [window.location.search, window.location.hash],
    [LAUNCH_URL.search, LAUNCH_URL.hash],
  ] as const;
  return sources.some(
    ([search, hash]) =>
      Boolean(readInitDataFrom(search, hash)) || /tgWebApp(Platform|Version)=/.test(search + hash),
  );
}

export function isTelegramSession(): boolean {
  return Boolean(getInitData()) || isTelegramClient() || hasLaunchParams();
}

export function getInitData(): string {
  const webApp = getTelegramWebApp();
  if (webApp?.initData) {
    cacheInitData(webApp.initData);
    return webApp.initData;
  }
  const fromUrl =
    readInitDataFrom(window.location.search, window.location.hash) ||
    readInitDataFrom(LAUNCH_URL.search, LAUNCH_URL.hash);
  if (fromUrl) {
    cacheInitData(fromUrl);
    return fromUrl;
  }
  return readCachedInitData();
}

/** Resolves with initData as soon as it appears, or "" after timeoutMs. */
export function waitForInitData(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const existing = getInitData();
    if (existing) {
      resolve(existing);
      return;
    }
    const start = Date.now();
    const tick = () => {
      const data = getInitData();
      if (data) {
        resolve(data);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve("");
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

/**
 * startapp deep-link param: SDK first, then the launch-URL snapshot
 * (covers launches where telegram-web-app.js failed to load).
 */
export function getStartParam(): string {
  const fromSdk = getTelegramWebApp()?.startParam;
  if (fromSdk) return fromSdk;
  try {
    return (
      new URLSearchParams(window.location.search).get("startapp") ||
      new URLSearchParams(LAUNCH_URL.search).get("startapp") ||
      ""
    );
  } catch {
    return "";
  }
}

export function canRequestLocation(): boolean {
  const webApp = getTelegramWebApp();
  return Boolean(webApp && typeof webApp.requestLocation === "function");
}

export function requestLocation(): Promise<{ lat: number; lng: number } | null> {
  const webApp = getTelegramWebApp();
  const requestLocation = webApp?.requestLocation;
  if (!webApp || typeof requestLocation !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: { lat: number; lng: number } | null) => {
      if (settled) return;
      settled = true;
      try {
        webApp.offEvent?.("locationRequested", handler);
      } catch {
        /* noop */
      }
      resolve(value);
    };
    const handler = (data?: unknown) => {
      const payload = data as {
        response?: boolean;
        location?: { latitude?: number; longitude?: number };
      } | undefined;
      if (payload?.response && payload.location?.latitude != null && payload.location.longitude != null) {
        try { webApp.expand(); } catch { /* noop */ }
        settle({ lat: payload.location.latitude, lng: payload.location.longitude });
      } else {
        settle(null);
      }
    };

    try {
      webApp.onEvent("locationRequested", handler);
      requestLocation();
    } catch {
      settle(null);
      return;
    }

    setTimeout(() => settle(null), 60_000);
  });
}

export type InvoiceStatus = "paid" | "failed" | "cancelled" | "pending" | "unknown";

export function payInvoice(url: string): Promise<InvoiceStatus> {
  const webApp = getTelegramWebApp();
  const openInvoice = webApp?.openInvoice;
  if (!webApp || typeof openInvoice !== "function") {
    return Promise.resolve("unknown");
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (status: InvoiceStatus) => {
      if (settled) return;
      settled = true;
      try {
        webApp.offEvent?.("invoiceClosed", handler);
      } catch {
        /* noop */
      }
      resolve(status);
    };
    const handler = (data?: unknown) => {
      const payload = data as { url?: string; status?: string } | undefined;
      if (payload?.url && payload.url !== url) return;
      const raw = payload?.status;
      if (raw === "paid" || raw === "failed" || raw === "cancelled" || raw === "pending") {
        settle(raw);
      } else {
        settle("unknown");
      }
    };

    try {
      webApp.onEvent("invoiceClosed", handler);
      openInvoice(url);
    } catch {
      settle("unknown");
    }

    setTimeout(() => settle("pending"), 120_000);
  });
}

export function canRequestPhone(): boolean {
  const webApp = getTelegramWebApp();
  return Boolean(webApp && typeof webApp.requestPhone === "function");
}

/**
 * Closes the mini app, dropping the user back into the bot chat — the
 * closest thing Telegram offers to "minimize". Used right after asking the
 * bot for a phone/location share, so the request keyboard is in view.
 */
export function closeToChat(): void {
  const webApp = getTelegramWebApp();
  try {
    webApp?.close();
  } catch {
    /* noop */
  }
}

export function openExternalLink(url: string): void {
  const webApp = getTelegramWebApp();
  if (typeof webApp?.openLink === "function") {
    webApp.openLink(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export function openTelegramLink(url: string): void {
  const webApp = getTelegramWebApp();
  if (webApp && typeof webApp.openTelegramLink === "function") {
    webApp.openTelegramLink(url);
  } else {
    openExternalLink(url);
  }
}

function webAppMajorVersion(): number {
  const raw = getTelegramWebApp()?.version ?? "";
  const major = Number(String(raw).split(".")[0]);
  return Number.isFinite(major) ? major : 0;
}

/**
 * True when the client supports Telegram.WebApp.shareMessage (Bot API 8.0+):
 * the native forward sheet that posts a server-prepared message (photo +
 * caption + button) into any chat the user picks — nothing is posted into
 * the user's own bot chat.
 * See https://core.telegram.org/bots/webapps#initializing-mini-apps
 */
export function canShareMessage(): boolean {
  const webApp = getTelegramWebApp();
  return (
    Boolean(webApp) &&
    typeof webApp?.shareMessage === "function" &&
    webAppMajorVersion() >= 8
  );
}

/**
 * Open the native forward sheet for a prepared message id previously
 * obtained via the Bot API method savePreparedInlineMessage. Resolves true
 * when Telegram reports the message was sent, false when the user dismisses
 * the sheet, the client lacks support, or the call times out.
 */
export function sharePreparedMessage(preparedId: string, timeoutMs = 60_000): Promise<boolean> {
  const webApp = getTelegramWebApp();
  const shareFn = typeof webApp?.shareMessage === "function" ? webApp.shareMessage : undefined;
  if (!webApp || !shareFn) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (sent: boolean) => {
      if (settled) return;
      settled = true;
      resolve(sent);
    };
    try {
      shareFn.call(webApp, preparedId, (sent: boolean) => settle(sent === true));
    } catch {
      settle(false);
      return;
    }
    setTimeout(() => settle(false), timeoutMs);
  });
}

/**
 * True when the app can prove the user to the bot via sendData. Per the
 * docs this method exists exactly for keyboard-button launches — the one
 * entry that may carry no session data at all.
 */
export function canSendData(): boolean {
  const webApp = getTelegramWebApp();
  return Boolean(webApp) && typeof webApp?.sendData === "function";
}

/**
 * Verify-login fallback: sends a login ping to the bot as a service
 * message (proves the Telegram user identity server-side) and closes the
 * mini app. The bot replies in the chat with a one-tap Shop button, which
 * re-opens the app as an inline launch WITH full session data.
 * Returns false when sendData is unavailable (caller should show guidance).
 */
export function sendLoginRequest(): boolean {
  const webApp = getTelegramWebApp();
  const send = typeof webApp?.sendData === "function" ? webApp.sendData : undefined;
  if (!webApp || !send) return false;
  try {
    send.call(webApp, "sabacos:login");
    return true;
  } catch {
    return false;
  }
}

/**
 * Compact launch diagnostics for the auth error banner, so a failure
 * report tells us exactly what Telegram provided:
 * sdk (object present), v (client version), data (initData bytes),
 * params (launch params in URL).
 */
export function getLaunchDiagnostics(): string {
  const webApp = getTelegramWebApp();
  const sdk = webApp ? 1 : 0;
  const version = typeof webApp?.version === "string" && webApp.version ? webApp.version : "none";
  let dataBytes = 0;
  try {
    dataBytes = (webApp?.initData ?? "").length;
  } catch {
    /* noop */
  }
  let params = 0;
  try {
    params = hasLaunchParams() ? 1 : 0;
  } catch {
    /* noop */
  }
  return `tg sdk=${sdk} v=${version} data=${dataBytes}b params=${params}`;
}

export function requestPhoneNumber(): Promise<string | null> {
  const webApp = getTelegramWebApp();
  const requestPhone = webApp?.requestPhone;
  if (!webApp || typeof requestPhone !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      try {
        webApp.offEvent?.("phoneRequested", handler);
      } catch {
        /* noop */
      }
      resolve(value);
    };
    const handler = (data?: unknown) => {
      const payload = data as { response?: boolean; phoneNumber?: string } | undefined;
      if (payload?.response && payload.phoneNumber) {
        try { webApp.expand(); } catch { /* noop */ }
        settle(payload.phoneNumber);
      } else {
        settle(null);
      }
    };

    try {
      webApp.onEvent("phoneRequested", handler);
      requestPhone();
    } catch {
      settle(null);
      return;
    }

    setTimeout(() => settle(null), 60_000);
  });
}