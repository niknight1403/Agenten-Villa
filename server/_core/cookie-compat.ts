/**
 * Cookie-Kompatibilitaetsschicht (Sprint 011-Fix).
 *
 * `cookie` v2 (Dependency-Update PR #10) ist ESM-only und hat den Export
 * `parse` in `parseCookie` umbenannt. Diese Schicht akzeptiert beide
 * Major-Versionen, damit die Runtime mit v1 und v2 startet — der Bundle-
 * Schritt (esbuild --packages=external) prueft keine Laufzeit-Exports,
 * daher greift der Schutz erst hier.
 */
import * as cookieModule from "cookie";

type CookieParseFn = (header: string) => Record<string, string>;

const cookieModuleRecord = cookieModule as unknown as Record<string, unknown>;

/** v1: parse — v2: parseCookie. Beide liefern Record<string, string>. */
export const parseCookieHeader: CookieParseFn =
  typeof cookieModuleRecord.parse === "function"
    ? (cookieModuleRecord.parse as CookieParseFn)
    : (cookieModuleRecord.parseCookie as CookieParseFn);
