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
  openLink: (url: string) => void;
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

export const tg = getTelegramWebApp();

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

export function isTelegramSession(): boolean {
  return Boolean(getInitData());
}

export function getInitData(): string {
  const webApp = getTelegramWebApp();
  if (webApp?.initData) return webApp.initData;

  // Fallback: Telegram also places signed data in the URL as tgWebAppData=...
  const hashMatch = window.location.hash.match(/tgWebAppData=([^&]*)/);
  if (hashMatch?.[1]) {
    try {
      return decodeURIComponent(hashMatch[1]);
    } catch {
      /* fall through */
    }
  }
  try {
    const fromSearch = new URLSearchParams(window.location.search).get("tgWebAppData");
    if (fromSearch) return fromSearch;
  } catch {
    /* noop */
  }
  return "";
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

export function openExternalLink(url: string): void {
  const webApp = getTelegramWebApp();
  if (typeof webApp?.openLink === "function") {
    webApp.openLink(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
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