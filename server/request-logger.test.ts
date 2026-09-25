import { describe, expect, it, vi, afterEach } from "vitest";
import {
  jsonErrorHandler,
  requestLogger,
} from "./_core/request-logger";

type FakeRes = {
  statusCode: number;
  headersSent: boolean;
  body?: unknown;
  listeners: Record<string, Array<() => void>>;
  on(event: string, fn: () => void): void;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headersSent: false,
    listeners: {},
    on(event, fn) {
      res.listeners[event] ??= [];
      res.listeners[event].push(fn);
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request logger", () => {
  it("loggt Methode, Pfad ohne Query, Status und Dauer", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = fakeRes();
    let nextCalled = false;
    requestLogger()({ method: "GET", url: "/api/x?token=1", originalUrl: "/api/x?token=1" } as never, res as never, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    res.statusCode = 201;
    for (const fn of res.listeners.finish) fn();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[http\] GET \/api\/x -> 201 \(\d+ms\)$/)
    );
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
  it("antwortet mit JSON-500 ohne Interna", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = fakeRes();
    jsonErrorHandler()(new Error("geheim-Stack"), {} as never, res as never, (() => {}) as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Interner Serverfehler." });
    expect(error).toHaveBeenCalled();
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
