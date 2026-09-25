import type { Request, RequestHandler } from "express";

/**
 * Kleiner In-Memory-Sliding-Window-Limiter (prozesslokal, ohne Redis).
 * Passt zum Free-Tier: schuetzt Login-/OAuth-Endpunkte vor Brute-Force
 * und versehentlichen Schleifen, ohne externe Abhaengigkeiten.
 */

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

const hits = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 5_000;

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function prune(now: number, windowMs: number): void {
  if (hits.size <= MAX_TRACKED_KEYS) return;
  for (const key of Array.from(hits.keys())) {
    const stamps: number[] = hits.get(key) ?? [];
    const fresh = stamps.filter((t: number) => now - t < windowMs);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, keyPrefix } = options;
  return (req, res, next) => {
    const now = Date.now();
    prune(now, windowMs);
    const key = `${keyPrefix}:${clientIp(req)}`;
    const stamps = (hits.get(key) ?? []).filter(t => now - t < windowMs);
    if (stamps.length >= max) {
      res
        .status(429)
        .set("Retry-After", String(Math.ceil(windowMs / 1_000)))
        .json({ error: "Too many requests, please retry later." });
      return;
    }
    stamps.push(now);
    hits.set(key, stamps);
    next();
  };
}

/** Nur fuer Tests: Zustand zuruecksetzen. */
export function resetRateLimiterForTests(): void {
  hits.clear();
}
