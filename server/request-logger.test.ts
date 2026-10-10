import { describe, expect, it, vi, afterEach } from "vitest";
import { jsonErrorHandler, requestLogger } from "./_core/request-logger";
import { newCorrelationId } from "./structured-log";

type FakeRes = {
  statusCode: number;
  headersSent: boolean;
  body?: unknown;
  headers: Record<string, string>;
  listeners: Record<string, Array<() => void>>;
  on(event: string, fn: () => void): void;
  setHeader(name: string, value: string): void;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headersSent: false,
    headers: {},
    listeners: {},
    on(event, fn) {
      res.listeners[event] ??= [];
      res.listeners[event].push(fn);
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

/** Hilfsfunktion: JSON-Zeile aus dem Logger-Aufruf parsen. */
function parsedLogLine(log: ReturnType<typeof vi.spyOn>, call = 0) {
  expect(log).toHaveBeenCalled();
  const line = String((log as { mock: { calls: unknown[][] } }).mock.calls[call][0]);
  return JSON.parse(line) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("structured request logger (Sprint 078)", () => {
  it("loggt eine JSON-Zeile mit Korrelation, Status und Dauer", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = fakeRes();
    let nextCalled = false;
    requestLogger()({ method: "GET", url: "/api/x?token=1", originalUrl: "/api/x?token=1" } as never, res as never, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    res.statusCode = 201;
    for (const fn of res.listeners.finish) fn();

    const line = parsedLogLine(log);
    expect(line.event).toBe("http_request");
    expect(line.level).toBe("info");
    expect(line.method).toBe("GET");
    expect(line.path).toBe("/api/x"); // Query (token=1) bleibt draußen
    expect(line.status).toBe(201);
    expect(typeof line.durationMs).toBe("number");
    expect(typeof line.correlationId).toBe("string");
    expect(line.correlationId).toMatch(/^[0-9a-f]{12}$/);
  });

  it("gibt die Korrelations-ID als X-Request-Id-Antwortkopf zurück", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = fakeRes();
    requestLogger()({ method: "GET", url: "/api/y", originalUrl: "/api/y" } as never, res as never, () => {});
    expect(res.headers["X-Request-Id"]).toMatch(/^[0-9a-f]{12}$/);
    for (const fn of res.listeners.finish) fn();
  });

  it("korreliert aufeinanderfolgende Requests mit frischen IDs", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const path of ["/api/a", "/api/b"]) {
      const res = fakeRes();
      requestLogger()({ method: "GET", url: path, originalUrl: path } as never, res as never, () => {});
      for (const fn of res.listeners.finish) fn();
    }
    const first = parsedLogLine(log, 0);
    const second = parsedLogLine(log, 1);
    expect(first.correlationId).not.toBe(second.correlationId);
  });

  it("schweigt bei Health-Checks", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = fakeRes();
    requestLogger()({ method: "GET", originalUrl: "/api/health" } as never, res as never, () => {});
    for (const fn of res.listeners.finish) fn();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("json error handler", () => {
  it("antwortet mit JSON-500 inklusive requestId, ohne Interna", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    jsonErrorHandler()(new Error("geheim-Stack"), {} as never, res as never, (() => {}) as never);
    expect(res.statusCode).toBe(500);
    const body = res.body as { error: string; requestId: string };
    expect(body.error).toBe("Interner Serverfehler.");
    expect(body.requestId).toMatch(/^[0-9a-f]{12}$/);
    // Interne Meldungen dringen nicht in die Antwort — nur in die strukturierte Logzeile.
    expect(JSON.stringify(res.body)).not.toContain("geheim-Stack");

    const line = parsedLogLine(error);
    expect(line.event).toBe("unhandled_request_error");
    expect(line.level).toBe("error");
    expect(line.correlationId).toBe(body.requestId);
    expect(typeof line.status).toBe("undefined"); // Status steht implizit auf 500 in der Antwort
  });

  it("wuerdigt bereits gesendete Header", () => {
    const res = fakeRes();
    res.headersSent = true;
    expect(() =>
      jsonErrorHandler()(new Error("x"), {} as never, res as never, (() => {}) as never)
    ).not.toThrow();
    expect(res.body).toBeUndefined();
  });
});

describe("newCorrelationId", () => {
  it("erzeugt eindeutige, kompakte Hex-IDs", () => {
    const ids = new Set(Array.from({ length: 64 }, () => newCorrelationId()));
    expect(ids.size).toBe(64);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});
