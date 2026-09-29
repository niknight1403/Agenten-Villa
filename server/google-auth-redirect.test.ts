import { afterEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { getRedirectUri } from "./_core/googleAuth";

/**
 * Regressionstest fuer den Login-Fehler "token_exchange_failed".
 *
 * Start und Callback muessen dieselbe redirect_uri bilden, und diese muss exakt
 * der in der Google Cloud Console registrierten entsprechen. Hinter einem
 * Reverse-Proxy (Render) kamen X-Forwarded-* als Komma-Liste an, wodurch eine
 * nicht registrierte URI entstand und der Token-Tausch mit
 * redirect_uri_mismatch fehlschlug.
 */

function req(headers: Record<string, string | string[]>, protocol = "http"): Request {
  return {
    protocol,
    headers,
    get(name: string) {
      const value = headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },
  } as unknown as Request;
}

afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
});

describe("getRedirectUri", () => {
  it("nutzt den ersten Eintrag einer komma-separierten Proxy-Kette", () => {
    const uri = getRedirectUri(
      req({
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "agenten-villa.onrender.com, 10.0.0.1",
      })
    );
    expect(uri).toBe(
      "https://agenten-villa.onrender.com/api/auth/google/callback"
    );
  });

  it("faellt auf Protokoll und Host des Requests zurueck", () => {
    const uri = getRedirectUri(
      req({ host: "agenten-villa.onrender.com" }, "https")
    );
    expect(uri).toBe(
      "https://agenten-villa.onrender.com/api/auth/google/callback"
    );
  });

  it("bevorzugt PUBLIC_BASE_URL und normalisiert einen Slash am Ende", () => {
    process.env.PUBLIC_BASE_URL = "https://agenten-villa.onrender.com/";
    const uri = getRedirectUri(
      req({ "x-forwarded-host": "intern:3000" }, "http")
    );
    expect(uri).toBe(
      "https://agenten-villa.onrender.com/api/auth/google/callback"
    );
  });

  it("liefert nie einen leeren Host oder eine Doppel-Schema-URI", () => {
    const uri = getRedirectUri(req({}, "https"));
    expect(uri).toMatch(/^https:\/\/[^/]+\/api\/auth\/google\/callback$/);
    expect(uri).not.toContain("://https");
  });
});
