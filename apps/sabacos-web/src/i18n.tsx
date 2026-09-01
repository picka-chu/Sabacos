import {
  DEFAULT_LANGUAGE,
  getDictionary,
  t as coreT,
  type I18nKey,
  type Language,
} from "@sabacos/core";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { tg } from "./telegram.js";

const STORAGE_KEY = "sabacos:lang";
const USER_CHOSE_KEY = "sabacos:lang:chose";

/** Check if the user has explicitly chosen a language in this session. */
export function hasUserChosenLang(): boolean {
  try {
    return sessionStorage.getItem(USER_CHOSE_KEY) === "1";
  } catch {
    return false;
  }
}

function initialLang(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "am") return stored;
  } catch {
    /* noop */
  }
  const code = tg?.initDataUnsafe?.user?.language_code;
  if (code?.toLowerCase().startsWith("am")) return "am";
  return DEFAULT_LANGUAGE;
}

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  dict: Record<I18nKey, string>;
  dir: "ltr" | "rtl";
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLang);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      sessionStorage.setItem(USER_CHOSE_KEY, "1");
    } catch {
      /* noop */
    }
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => coreT(lang, key, params),
      dict: getDictionary(lang),
      dir: "ltr",
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}