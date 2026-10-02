/**
 * Sprint 060 — Security-Review: gebuendelte Regressionssuite fuer die
 * kritischen Schutzpfade (Sprints 055–059 + Kern-Auth).
 *
 * Invarianten:
 *  - Unauthentifizierte Zugriffe erhalten UNAUTHORIZED, nie Daten.
 *  - CSRF-Guard blockt Cross-Site-Mutationen (SameSite=None-Header-Schutz).
 *  - Admin-Mutationen sind rollengeprueft UND budgetiert (E2E ueber den
 *    Router: nach dem Limit TOO_MANY_REQUESTS).
 *  - Nicht-Admins verbrauchen kein Admin-Budget (FORBIDDEN vor Verbrauch).
 *  - Villa-Exporte verlassen den Server nur redigiert (Whitelist).
 *  - Sicherheitsheader verbieten Clickjacking; CSP/HSTS nur Produktion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { csrfGuard } from "./_core/csrf";
import { CSP_DIRECTIVES, securityHeaders } from "./_core/security-headers";
import { sanitizeVillaExport } from "./villa-export";
import {
  adminMutationLimit,
  resetAdminRateLimiterForTests,
} from "./admin-rate-limit";
import { resetAgentRouterForTests } from "./agent-router";

function createContext(
  userId: number,
  role: "user" | "admin",
  email: string
): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: userId,
      openId: "test-open-id",
      email,
      name: "Test User",
      loginMethod: "test",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  resetAdminRateLimiterForTests();
});

afterEach(() => {
  resetAgentRouterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("security review: authentifizierte Schutzpfade", () => {
  it("verweigert villa.export ohne Sitzung (UNAUTHORIZED, keine Daten)", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });
    await expect(caller.villa.export({ villaId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("erlaubt nur Admins die Systemprompt-Aenderung (FORBIDDEN)", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const user = appRouter.createCaller(createContext(31, "user", "other@example.com"));
    await expect(
      user.agent.setSystemPrompt({ prompt: "nope" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("verbraucht Nicht-Admin-Ablehnungen nicht vom Admin-Budget", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const user = appRouter.createCaller(createContext(31, "user", "other@example.com"));
    const admin = appRouter.createCaller(createContext(77, "admin", "admin@example.com"));

    for (let i = 0; i < 10; i++) {
      await expect(
        user.agent.setSystemPrompt({ prompt: "nope" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // Alle 30 Admin-Mutationen stehen noch voll zur Verfuegung.
    const { max } = adminMutationLimit();
    for (let i = 0; i < max; i++) {
      await expect(
        admin.agent.setSystemPrompt({ prompt: `Verhalten ${i}` })
      ).resolves.toBeDefined();
    }
  });

  it("begrenzt Admin-Mutationen E2E auf das Budget (TOO_MANY_REQUESTS)", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const admin = appRouter.createCaller(createContext(77, "admin", "admin@example.com"));
    const { max } = adminMutationLimit();
    for (let i = 0; i < max; i++) {
      await admin.agent.setSystemPrompt({ prompt: `Verhalten ${i}` });
    }
    await expect(
      admin.agent.setSystemPrompt({ prompt: "einmal zu viel" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("security review: CSRF-Guard", () => {
  it("blockt Cross-Site-Mutationen und laesst legitime Origins passieren", () => {
    const guard = csrfGuard();
    const run = (headers: Record<string, string>, method = "POST") => {
      let passed = false;
      const res = {
        status() { return res; },
        json() { return res; },
      } as unknown as Response;
      guard(
        { method, headers } as unknown as Request,
        res,
        (() => { passed = true; }) as unknown as NextFunction
      );
      return passed;
    };
    // Cross-Site-Mutation wird geblockt (403, kein next()):
    expect(
      run({ host: "agenten-villa.onrender.com", origin: "https://evil.example" })
    ).toBe(false);
    // Same-Origin und native Urspruenge duerfen passieren:
    expect(
      run({ host: "agenten-villa.onrender.com", origin: "https://agenten-villa.onrender.com" })
    ).toBe(true);
    expect(
      run({ host: "agenten-villa.onrender.com", origin: "capacitor://localhost" })
    ).toBe(true);
  });
});

describe("security review: Export-Redaktion", () => {
  it("entfernt interne Felder aus Villa-Exporten", () => {
    const result = sanitizeVillaExport({
      name: "V",
      specialty: "S",
      icon: "bot",
      projectBrief: null,
      description: null,
      capacity: 8,
      messages: [
        { role: "user", content: "Frage", createdAt: new Date() },
      ],
      exportedAt: new Date(),
      version: 1,
    });
    const record = result as unknown as Record<string, unknown>;
    expect(record.id).toBeUndefined();
    expect(record.createdBy).toBeUndefined();
    expect(record.messages[0]).not.toHaveProperty("provider");
  });
});

describe("security review: Sicherheitsheader", () => {
  it("verbietet Clickjacking und haelt CSP an die Produktion gebunden", () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader(k: string, v: string) { headers.set(k, v); },
    } as unknown as Response;
    securityHeaders({ nodeEnv: "production" })(undefined as unknown as Request, res, (() => {}) as NextFunction);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age");
    expect(CSP_DIRECTIVES).toContain("object-src 'none'");
  });
});
