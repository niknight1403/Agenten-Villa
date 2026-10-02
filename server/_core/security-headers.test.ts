/**
 * Sprint 058 — Sicherheitsheader-Regression.
 *
 * Invarianten:
 *  - nosniff, DENY, Referrer-Policy und Permissions-Policy immer gesetzt.
 *  - CSP + HSTS nur in Produktion (Dev braucht Vite-HMR-Freiheit).
 *  - CSP verbietet frame-ancestors (Clickjacking), Objekte, fremde Scripte.
 */
import type { Request, Response, NextFunction } from "express";
import { describe, expect, it } from "vitest";
import { CSP_DIRECTIVES, securityHeaders } from "./security-headers";

function runHeaders(env?: string): Map<string, string> {
  const headers = new Map<string, string>();
  const res = {
    setHeader(k: string, v: string) {
      headers.set(k, v);
    },
  } as unknown as Response;
  securityHeaders({ nodeEnv: env })(undefined as unknown as Request, res, (() => {}) as NextFunction);
  return headers;
}

describe("securityHeaders", () => {
  it("setzt Basis-Header in jedem Modus", () => {
    for (const env of ["development", "production", undefined]) {
      const headers = runHeaders(env);
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("X-Frame-Options")).toBe("DENY");
      expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headers.get("Permissions-Policy")).toContain("camera=()");
      expect(headers.get("Permissions-Policy")).toContain("microphone=()");
    }
  });

  it("setzt CSP und HSTS nur in Produktion", () => {
    const prod = runHeaders("production");
    expect(prod.get("Content-Security-Policy")).toBe(CSP_DIRECTIVES);
    expect(prod.get("Strict-Transport-Security")).toContain("max-age=31536000");

    const dev = runHeaders("development");
    expect(dev.get("Content-Security-Policy")).toBeUndefined();
    expect(dev.get("Strict-Transport-Security")).toBeUndefined();
  });

  it("verbietet in der CSP Clickjacking, Objekte und fremde Scripte", () => {
    expect(CSP_DIRECTIVES).toContain("frame-ancestors 'none'");
    expect(CSP_DIRECTIVES).toContain("object-src 'none'");
    expect(CSP_DIRECTIVES).toContain("script-src 'self'");
    expect(CSP_DIRECTIVES).toContain("base-uri 'self'");
    expect(CSP_DIRECTIVES).toContain("form-action 'self'");
    // Inline-/Eval-Scripte bewusst NICHT erlaubt:
    expect(CSP_DIRECTIVES).not.toMatch(/script-src[^;]*unsafe/);
  });

  it("erlaubt Google Fonts in Styles/Fonts, aber nicht als Skript", () => {
    expect(CSP_DIRECTIVES).toContain("https://fonts.googleapis.com");
    expect(CSP_DIRECTIVES).toContain("https://fonts.gstatic.com");
    expect(CSP_DIRECTIVES).not.toMatch(/script-src[^;]*googleapis/);
  });
});
