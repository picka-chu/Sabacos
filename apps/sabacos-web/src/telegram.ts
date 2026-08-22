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

  try {
    const headerColor =
      p.bg_color ?? (colorScheme === "dark" ? "#2a000c" : "#fff5f9");
    webApp.setHeaderColor?.(headerColor);
    webApp.setBackgroundColor?.(headerColor);
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
      settle(payload?.response && payload.phoneNumber ? payload.phoneNumber : null);
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