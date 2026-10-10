/**
 * Sprint 093 — Mehrsprachigkeit vorbereiten: Vollstaendigkeit und Verhalten
 * des zentralen Textkatalogs sind gepinnt, damit spaetere Uebersetzungen
 * keine stillen Loecher reissen.
 *
 * Invarianten:
 *  - Jeder de-Schluessel existiert in jeder Sprache (und umgekehrt).
 *  - Fehlende Uebersetzungen fallen auf den de-Text zurueck, nie auf leer.
 *  - Platzhalter werden ersetzt; unbekannte bleiben sichtbar (ehrlich).
 *  - Locale-Speicherung toleriert ungueltige Werte und Privatmodus.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  detectBrowserLocale,
  interpolate,
  isLocale,
  messages,
  readStoredLocale,
  translate,
  writeStoredLocale,
  type Locale,
} from "./i18n";

describe("i18n-Textkatalog (Sprint 093)", () => {
  it("jeder de-Schluessel existiert in jeder Sprache — und umgekehrt", () => {
    const referenceKeys = Object.keys(messages[DEFAULT_LOCALE]);
    expect(referenceKeys.length).toBeGreaterThan(10);
    for (const locale of LOCALES) {
      const localeKeys = Object.keys(messages[locale]);
      expect(localeKeys).toEqual(expect.arrayContaining(referenceKeys));
      expect(localeKeys.length).toBe(referenceKeys.length);
    }
  });

  it("Schluessel sind flach und eindeutig pro Sprache", () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(messages[locale]);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) {
        expect(key).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/);
      }
    }
  });

  it("translate liefert de und en und faellt nie auf leer zurueck", () => {
    expect(translate("de", "budget.title")).toBe("Token-Budget");
    expect(translate("en", "budget.title")).toBe("Token budget");
    for (const key of Object.keys(messages[DEFAULT_LOCALE])) {
      for (const locale of LOCALES) {
        expect(translate(locale, key as never).length).toBeGreaterThan(0);
      }
    }
  });

  it("Platzhalter werden ersetzt; unbekannte bleiben sichtbar", () => {
    expect(interpolate("Letzter Tick {time}", { time: "12:00" })).toBe("Letzter Tick 12:00");
    expect(interpolate("Letzter Tick {time}", {})).toBe("Letzter Tick {time}");
    expect(translate("en", "budget.live.lastTick", { time: "12:00" })).toBe("Last tick 12:00");
  });

  it("isLocale erkennt nur bekannte Locales", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("Locale-Speicherung: gueltig liest, ungueltig faellt zurueck, Privatmodus wirft nicht", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    writeStoredLocale(storage, "en");
    expect(readStoredLocale(storage)).toBe("en");
    store.set("villaforge.locale", "fr");
    expect(readStoredLocale(storage)).toBeNull();

    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeStoredLocale(broken, "de")).not.toThrow();
    expect(readStoredLocale(broken)).toBeNull();
  });

  it("Browsersprache wird als Locale-Vorschlag erkannt", () => {
    expect(detectBrowserLocale({ language: "de-DE" })).toBe("de");
    expect(detectBrowserLocale({ language: "en-US" })).toBe("en");
    expect(detectBrowserLocale({ language: "fr-FR" })).toBeNull();
    expect(detectBrowserLocale(undefined)).toBeNull();
  });
});
