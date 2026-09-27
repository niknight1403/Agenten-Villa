import { readFileSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";

/**
 * Minimaler, oeffentlicher Health-Endpoint fuer Render-Checks und Smoke-Tests.
 * Bewusst ohne Geheimnisse und ohne Datenbankabfragen (muss immer schnell
 * antworten, auch im Free-Tier-Kaltstart).
 */

export type HealthPayload = {
  ok: true;
  version: string;
  mode: string;
  uptimeSec: number;
  timestamp: string;
};

let cachedVersion: string | null = null;

export function appVersion(): string {
  if (cachedVersion === null) {
    try {
      const raw = readFileSync(
        path.resolve(process.cwd(), "package.json"),
        "utf-8"
      );
      const pkg = JSON.parse(raw) as { version?: string };
      cachedVersion = String(pkg.version ?? "unknown");
    } catch {
      cachedVersion = "unknown";
    }
  }
  return cachedVersion;
}

/** Nur fuer Tests: Version-Cache zuruecksetzen. */
export function resetVersionCacheForTests(): void {
  cachedVersion = null;
}

export function getHealthPayload(): HealthPayload {
  return {
    ok: true,
    version: appVersion(),
    mode: process.env.NODE_ENV ?? "development",
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

export function registerHealthRoute(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.status(200).json(getHealthPayload());
  });
}
