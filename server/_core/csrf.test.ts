/**
 * Sprint 055 — CSRF-Guard-Regression.
 *
 * Der Session-Cookie ist SameSite=None (native WebView) — der Guard muss
 * alle Browser-Cross-Site-Mutationen abweisen und legitime Aufrufer
 * (same-origin Web, native Capacitor-Urspruenge, Nicht-Browser-Clients)
 * durchlassen.
 */
import type { Request, Response, NextFunction } from "express";
import { describe, expect, it, vi } from "vitest";
import { csrfGuard, isAllowedOrigin } from "./csrf";

type Handle = (req: Partial<Request>, res: Partial<Response>, next: NextFunction) => void;

function run(
  guard: Handle,
  req: Partial<Request>,
): { status?: number; body?: unknown; blocked: boolean } {
  let status: number | undefined;
  let body: unknown;
  let nextCalled = false;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  } as Partial<Response>;
  guard(req as Request, res as Response, (() => {
    nextCalled = true;
  }) as NextFunction);
  return { status, body, blocked: !nextCalled };
}

describe("csrfGuard", () => {
  const guard = csrfGuard();

  it("laesst same-origin POSTs passieren", () => {
    const result = run(guard, {
      method: "POST",
      headers: { host: "agenten-villa.onrender.com", origin: "https://agenten-villa.onrender.com" },
    });
    expect(result.blocked).toBe(false);
  });

  it("blockt POSTs von fremdem Origin (CSRF)", () => {
    const result = run(guard, {
      method: "POST",
      headers: { host: "agenten-villa.onrender.com", origin: "https://evil.example" },
    });
    expect(result.blocked).toBe(true);
    expect(result.status).toBe(403);
  });

  it("erlaubt native Capacitor-Urspruenge", () => {
    const native = run(guard, {
      method: "POST",
      headers: { host: "agenten-villa.onrender.com", origin: "http://localhost" },
    });
    expect(native.blocked).toBe(false);
    const capacitor = run(guard, {
      method: "POST",
      headers: { host: "agenten-villa.onrender.com", origin: "capacitor://localhost" },
    });
    expect(capacitor.blocked).toBe(false);
  });

  it("ignoriert safe methods (GET/HEAD/OPTIONS)", () => {
    const result = run(guard, {
      method: "GET",
      headers: { host: "agenten-villa.onrender.com", origin: "https://evil.example" },
    });
    expect(result.blocked).toBe(false);
  });

  it("prueft den Referer, wenn Origin fehlt", () => {
    const ok = run(guard, {
      method: "POST",
      headers: { host: "agenten-villa.onrender.com", referer: "https://agenten-villa.onrender.com/login" },
    });
    expect(ok.blocked).toBe(false);
    const evil = run(guard, {
      method: "POST",
      headers: { host: "agenten-villa.onrender.com", referer: "https://evil.example/form" },
    });
    expect(evil.blocked).toBe(true);
    expect(evil.status).toBe(403);
  });

  it("laesst Requests ohne Origin und Referer durch (Nicht-Browser)", () => {
    const result = run(guard, {
      method: "POST",
      headers: { host: "agenten-villa.onrender.com" },
    });
    expect(result.blocked).toBe(false);
  });

  it("blockt Port-/Host-Mismatch im Origin", () => {
    const result = run(guard, {
      method: "PUT",
      headers: { host: "agenten-villa.onrender.com", origin: "http://agenten-villa.onrender.com:5173" },
    });
    expect(result.blocked).toBe(true);
  });

  it("beruecksichtigt x-forwarded-host hinter dem Proxy", () => {
    const result = run(guard, {
      method: "POST",
      headers: {
        "x-forwarded-host": "agenten-villa.onrender.com",
        host: "render-internal:10000",
        origin: "https://agenten-villa.onrender.com",
      },
    });
    expect(result.blocked).toBe(false);
  });

  it("erlaubt explizit konfigurierte zusaetzliche Origins", () => {
    const custom = csrfGuard({ nativeOrigins: new Set(["https://app.example"]) });
    const ok = run(custom, {
      method: "POST",
      headers: { host: "api.example", origin: "https://app.example" },
    });
    expect(ok.blocked).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("erkennt Host-Gleichheit", () => {
    const req = { headers: { host: "villa.example" } } as unknown as Request;
    expect(isAllowedOrigin("villa.example", req)).toBe(true);
    expect(isAllowedOrigin("other.example", req)).toBe(false);
  });
});
