/**
 * Sprint 080 — Daten-Review: gebuendelte Regressionssuite fuer die drei
 * Betriebspfade Persistenz, Health und Logs. Sie pinnt die Invarianten,
 * die ein "gruenes" Produktionssystem ausmachen — bewusst auf reiner
 * Ebene (kein echter Datenbankserver noetig).
 *
 * Persistenzpfad:
 *  - upsertUser scheitert ehrlich (klare Fehler) statt still zu siegen.
 *  - getUserByOpenId degradiert sauber zu undefined, ohne zu stuerzen.
 *  - probeDatabaseConnection unterscheidet verbunden/fehler/nicht_konfiguriert.
 *
 * Health-Pfad:
 *  - GET /api/health antwortet 200 mit strukturiertem Payload (ok, version,
 *    providers, routing) und NIE mit Geheimnissen.
 *  - Der DB-Status ist Cache-Durchreichung: gesetzt durch den Hintergrund-
 *    Pruefer, nie blockierend im Request.
 *
 * Logpfad:
 *  - Zugriffslogs sind JSON mit Korrelation, Status und Dauer (Sprint 078).
 *  - Unbehandelte Fehler antworten JSON-500 mit requestId ohne Interna.
 *  - Geheimnisverdaechtige Felder erreichen nie eine Logzeile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeDatabaseConnection } from "./db-health";
import { getUserByOpenId, upsertUser } from "./db";
import {
  getHealthPayload,
  registerHealthRoute,
  resetDatabaseCacheForTests,
  resetVersionCacheForTests,
  setDatabaseHealthReport,
  type HealthPayload,
} from "./_core/health";
import { jsonErrorHandler, requestLogger } from "./_core/request-logger";
import { structuredLog } from "./structured-log";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetDatabaseCacheForTests();
  resetVersionCacheForTests();
});

describe("Daten-Review (Sprint 080): Persistenzpfad", () => {
  it("upsertUser ohne openId scheitert ehrlich", async () => {
    await expect(upsertUser({ openId: "" } as never)).rejects.toThrow("openId");
  });

  it("upsertUser ohne verfuegbare Datenbank scheitert ehrlich (DATABASE_UNAVAILABLE)", async () => {
    await expect(
      upsertUser({ openId: "auth0|offline", email: "x@example.com" })
    ).rejects.toThrow("DATABASE_UNAVAILABLE");
  });

  it("getUserByOpenId degradiert sauber zu undefined statt zu stuerzen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = await getUserByOpenId("auth0|offline");
    expect(user).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("DB-Sonde unterscheidet verbunden, Fehler und nicht konfiguriert", async () => {
    expect(await probeDatabaseConnection(null)).toBe("nicht_konfiguriert");
    expect(
      await probeDatabaseConnection({
        execute: async () => ({ rows: [] }),
      })
    ).toBe("verbunden");
    expect(
      await probeDatabaseConnection({
        execute: async () => {
          throw new Error("connection refused");
        },
      })
    ).toBe("fehler");
  });
});

describe("Daten-Review (Sprint 080): Health-Pfad", () => {
  it("health-Payload ist strukturiert, versioniert und ohne Geheimnisse", () => {
    const payload: HealthPayload = getHealthPayload();
    expect(payload.ok).toBe(true);
    expect(typeof payload.version).toBe("string");
    expect(payload.version.length).toBeGreaterThan(0);
    expect(typeof payload.uptimeSec).toBe("number");
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
    expect(Array.isArray(payload.providers)).toBe(true);
    expect(payload.routing).toHaveProperty("pinned");
    expect(payload.routing).toHaveProperty("activeRoute");
    const route = payload.routing.pinned;
    expect(route === null || typeof route === "string").toBe(true);
    // Der oeffentliche Payload enthaelt NIE Server-Secrets.
    expect(Object.keys(payload)).not.toContain("secrets");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/(sk-|ghp_|hf_)[A-Za-z0-9_-]+/);
  });

  it("DB-Status ist Cache-Durchreichung: gesetzt heisst sichtbar, ungesetzt heisst Feld weg", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect("database" in getHealthPayload()).toBe(false);
    setDatabaseHealthReport({
      status: "verbunden",
      checkedAt: new Date().toISOString(),
    });
    const withDb = getHealthPayload();
    expect(withDb.database?.status).toBe("verbunden");
    resetDatabaseCacheForTests();
    expect("database" in getHealthPayload()).toBe(false);
  });

  it("registerHealthRoute antwortet 200 mit dem Health-Payload", () => {
    const routes = new Map<string, (req: unknown, res: unknown) => void>();
    const fakeApp = {
      get: (path: string, handler: (req: unknown, res: unknown) => void) =>
        void routes.set(path, handler),
    };
    registerHealthRoute(fakeApp as never);
    const handler = routes.get("/api/health");
    expect(handler).toBeDefined();
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    handler?.(undefined, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as HealthPayload).ok).toBe(true);
  });
});

describe("Daten-Review (Sprint 080): Logpfad", () => {
  it("Zugriffslog ist JSON mit Korrelation, Status und Dauer", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      listeners: {} as Record<string, Array<() => void>>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      on(event: string, fn: () => void) {
        this.listeners[event] ??= [];
        this.listeners[event].push(fn);
      },
    };
    requestLogger()(
      { method: "POST", url: "/api/villas", originalUrl: "/api/villas" } as never,
      res as never,
      () => {}
    );
    for (const fn of res.listeners.finish) fn();
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(log.mock.calls[0][0])) as Record<string, unknown>;
    expect(line.event).toBe("http_request");
    expect(line.status).toBe(200);
    expect(typeof line.durationMs).toBe("number");
    expect(String(line.correlationId)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("unbehandelte Fehler: JSON-500 mit requestId, ohne Interna", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = {
      statusCode: 0,
      headersSent: false,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    jsonErrorHandler()(
      new Error("interner-Stack-detail"),
      {} as never,
      res as never,
      (() => {}) as never
    );
    expect(res.statusCode).toBe(500);
    const body = res.body as { error: string; requestId: string };
    expect(body.error).toBe("Interner Serverfehler.");
    expect(body.requestId).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(res.body)).not.toContain("interner-Stack-detail");
    const line = JSON.parse(String(error.mock.calls[0][0])) as Record<string, unknown>;
    expect(line.event).toBe("unhandled_request_error");
  });

  it("geheimnisverdaechtige Felder erreichen nie eine Logzeile", () => {
    const lines: unknown[][] = [];
    const logger = {
      log: (...a: unknown[]) => void lines.push(a),
      warn: () => {},
      error: () => {},
    };
    structuredLog(
      "info",
      "provider_probe",
      { apiKey: "sk-geheim", provider: "openrouter", token: "ghp_1" },
      logger
    );
    const line = JSON.parse(String(lines[0][0])) as Record<string, unknown>;
    expect(line.provider).toBe("openrouter");
    expect(JSON.stringify(line)).not.toContain("sk-geheim");
    expect(JSON.stringify(line)).not.toContain("ghp_1");
  });
});
