/**
 * Sprint 011: Cookie-Kompatibilitaetsschicht — akzeptiert cookie v1 und v2.
 */
import { describe, expect, it } from "vitest";
import { parseCookieHeader } from "./cookie-compat";

describe("parseCookieHeader (cookie v1/v2-kompatibel)", () => {
  it("parst einen Standard-Cookie-Header", () => {
    expect(parseCookieHeader("session=abc; theme=dark")).toEqual({ session: "abc", theme: "dark" });
  });

  it("liefert bei leerem Header ein leeres Objekt", () => {
    expect(parseCookieHeader("")).toEqual({});
  });

  it("dekodiert URL-kodierte Werte", () => {
    expect(parseCookieHeader("state=a%20b")).toEqual({ state: "a b" });
  });

  it("ist eine Funktion (v1 parse ODER v2 parseCookie gefunden)", () => {
    expect(typeof parseCookieHeader).toBe("function");
  });
});
