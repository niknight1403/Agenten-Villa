import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clientIp,
  rateLimit,
  resetRateLimiterForTests,
} from "./_core/rate-limit";
import type { Request, RequestHandler } from "express";

type Res = {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  status(code: number): Res;
  set(name: string, value: string): Res;
  json(payload: unknown): Res;
};

function fakeReq(ip = "203.0.113.7"): Request {
  return {
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function fakeRes(): Res {
  const res: Res = {
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function run(handler: RequestHandler, ip: string): Res {
  const res = fakeRes();
  let nextCalled = false;
  handler(fakeReq(ip), res as never, () => {
    nextCalled = true;
  });
  expect(res.body ?? true).toBeTruthy();
  return nextCalled
    ? ({ ok: true } as unknown as Res)
    : res;
}

beforeEach(() => {
  resetRateLimiterForTests();
  vi.restoreAllMocks();
});

describe("auth rate limit", () => {
  it("blockiert nach max Anfragen pro IP im Fenster mit 429 + Retry-After", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3, keyPrefix: "auth" });
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    expect(run(limiter, "203.0.113.7")).toEqual({ ok: true });
    expect(run(limiter, "203.0.113.7")).toEqual({ ok: true });
    expect(run(limiter, "203.0.113.7")).toEqual({ ok: true });
    const blocked = run(limiter, "203.0.113.7") as never as {
      statusCode: number;
      headers: Record<string, string>;
      body: { error: string };
    };
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["Retry-After"]).toBe("60");
    expect(blocked.body.error).toContain("Too many requests");
  });

  it("zaehlt IPs getrennt", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "auth" });
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    expect(run(limiter, "198.51.100.1")).toEqual({ ok: true });
    expect(run(limiter, "198.51.100.2")).toEqual({ ok: true });
  });

  it("gibt nach Ablauf des Fensters wieder frei (Sliding Window)", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: "auth" });
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    expect(run(limiter, "203.0.113.7")).toEqual({ ok: true });
    expect(run(limiter, "203.0.113.7").statusCode).toBe(429);
    now += 61_000;
    expect(run(limiter, "203.0.113.7")).toEqual({ ok: true });
  });

  it("erkennt die erste Client-IP hinter einem Proxy", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      socket: { remoteAddress: "10.0.0.1" },
    } as unknown as Request;
    expect(clientIp(req)).toBe("203.0.113.9");
  });
});
