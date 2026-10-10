/**
 * Sprint 093 — Mehrsprachigkeit vorbereiten: alle uebersetzbaren UI-Texte
 * liegen ZENTRAL in einem Katalog (de = Referenz, en = erste Zielsprache)
 * und werden ueber t() mit Platzhalter-Ersetzung geliefert.
 *
 * Regeln:
 *  - Schluessel sind stabil ("namespace.bezug") und werden nie umbenannt,
 *    ohne Mitfuehrung aller Aufrufstellen.
 *  - de ist die Referenzsprache: jeder de-Schluessel MUSS in jeder anderen
 *    Sprache existieren (Test sichert das).
 *  - Fehlt eine Uebersetzung, greift der de-Text als Fallback — niemals
 *    ein leerer String.
 *  - Das Katalogformat ist flach: keine verschachtelten Objekte, dadurch
 *    bleibt der Vollstaendigkeits-Test simpel und der Lookup O(1).
 */

export type Locale = "de" | "en";

export const LOCALES: readonly Locale[] = ["de", "en"] as const;

export const DEFAULT_LOCALE: Locale = "de";

export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return value === "de" || value === "en";
}

/**
 * Der zentrale Textkatalog. Schluessel-Konvention: "bereich.text".
 * Neue UI-Texte werden HIER gepflegt, nicht inline in Komponenten.
 */
export const messages = {
  de: {
    // gemeinsame Aktionen
    "common.save": "Speichern",
    "common.cancel": "Abbrechen",
    "common.reset": "Zurücksetzen",
    "common.loading": "Lädt …",
    "common.error": "Etwas ist schiefgelaufen.",
    "common.optional": "optional",

    // Token-/Budget-Widget
    "budget.title": "Token-Budget",
    "budget.subtitle":
      "Live-Verbrauch je Anbieter — begrenzte Prozesshistorie, kein Nutzinhalt",
    "budget.live.lastTick": "Letzter Tick {time}",
    "budget.live.waiting": "warte auf ersten Tick",
    "budget.live.connecting": "Verbinde …",
    "budget.empty":
      "Noch keine Nutzungsdaten — der erste Watchdog-Tick meldet sich innerhalb einer Minute.",
    "budget.tile.turns": "Turns",
    "budget.tile.promptTokens": "Prompt-Tokens",
    "budget.tile.completionTokens": "Antwort-Tokens",
    "budget.tile.totalTokens": "Tokens gesamt",
    "budget.tile.costs": "Geschätzte Kosten",

    // Sprachumschaltung
    "language.label": "Sprache",
  },
  en: {
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.reset": "Reset",
    "common.loading": "Loading …",
    "common.error": "Something went wrong.",
    "common.optional": "optional",

    "budget.title": "Token budget",
    "budget.subtitle":
      "Live usage per provider — bounded process history, no user content",
    "budget.live.lastTick": "Last tick {time}",
    "budget.live.waiting": "waiting for first tick",
    "budget.live.connecting": "Connecting …",
    "budget.empty":
      "No usage data yet — the first watchdog tick reports within a minute.",
    "budget.tile.turns": "Turns",
    "budget.tile.promptTokens": "Prompt tokens",
    "budget.tile.completionTokens": "Completion tokens",
    "budget.tile.totalTokens": "Total tokens",
    "budget.tile.costs": "Estimated cost",

    "language.label": "Language",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type MessageKey = keyof (typeof messages)["de"];

/** Ersetzt {platzhalter} im Text durch Werte. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/** Kern-Übersetzung: Sprache, Schluessel, Platzhalter; Fallback auf de. */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const inLocale = messages[locale][key];
  const fallback = messages[DEFAULT_LOCALE][key];
  const template = inLocale ?? fallback ?? String(key);
  return interpolate(template, vars);
}

const STORAGE_KEY = "villaforge.locale";

/** Locale aus localStorage; ungueltige Werte fallen auf die Standard-Sprache zurueck. */
export function readStoredLocale(storage: Pick<Storage, "getItem">): Locale | null {
  const stored = storage.getItem(STORAGE_KEY);
  return isLocale(stored) ? stored : null;
}

export function writeStoredLocale(
  storage: Pick<Storage, "setItem">,
  locale: Locale
): void {
  try {
    storage.setItem(STORAGE_KEY, locale);
  } catch {
    /* localStorage nicht verfuegbar (Privatmodus) — Locale gilt nur fuer diese Sitzung. */
  }
}

/** Browsersprache als Locale-Vorschlag (navigator nur im Browser vorhanden). */
export function detectBrowserLocale(navigatorLike?: { language?: string }): Locale | null {
  const language = navigatorLike?.language?.toLowerCase();
  if (!language) return null;
  if (language.startsWith("de")) return "de";
  if (language.startsWith("en")) return "en";
  return null;
}
