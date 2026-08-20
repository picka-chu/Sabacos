export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
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
  onEvent: (eventType: string, callback: () => void) => void;
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