import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  readStoredLocale,
  translate,
  writeStoredLocale,
  type Locale,
  type MessageKey,
} from "@/lib/i18n";

/**
 * Sprint 093 — Mehrsprachigkeit vorbereiten: die Sprachwahl ist app-weit
 * ueber einen Provider verfuegbar und wird pro Browser gespeichert.
 * Standard ist Deutsch; ungueltige oder fehlende Werte fallen ehrlich
 * auf die Standardsprache zurueck (Katalog-Fallback siehe lib/i18n.ts).
 */
export type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Uebersetzt einen Katalog-Schluessel mit optionalen Platzhaltern. */
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  try {
    const stored = readStoredLocale(window.localStorage);
    if (stored) return stored;
  } catch {
    /* localStorage nicht verfuegbar */
  }
  return detectBrowserLocale(window.navigator) ?? DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Reiner Client-Bau (Vite, kein SSR): window ist immer vorhanden.
  // Fehlerfaelle (Privatmodus, ungueltige Werte) faellt initialLocale
  // ehrlich auf die Standardsprache zurueck.
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      writeStoredLocale(window.localStorage, next);
    } catch {
      /* Privatmodus: gilt nur fuer diese Sitzung */
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n muss innerhalb von <I18nProvider> verwendet werden.");
  }
  return context;
}
