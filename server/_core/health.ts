import { readFileSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import type { DatabaseHealthReport } from "../db-health";

/**
 * Minimaler, oeffentlicher Health-Endpoint fuer Render-Checks und Smoke-Tests.
 * Bewusst ohne Geheimnisse und ohne blockierende Datenbankabfragen: der
 * DB-Status wird beim Start (und periodisch im Hintergrund) gesetzt und hier
 * nur aus dem Cache gelesen — der Endpoint antwortet auch im Free-Tier-
 * Kaltstart sofort. Render-Checks bleiben bei HTTP 200, damit der Service
 * bei DB-Problemen nicht in eine Neustart-Schleife geraet; der degradation
 * ist ueber das database-Feld sichtbar.
 */

export type HealthPayload = {
  ok: true;
  version: string;
  mode: string;
  uptimeSec: number;
  timestamp: string;
  /** Sprint 011: DB-Verfuegbarkeit (gecacht, nie blockierend). */
  database?: DatabaseHealthReport;
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

let cachedDatabaseReport: DatabaseHealthReport | null = null;

/** Nur fuer Tests: DB-Status-Cache zuruecksetzen. */
export function resetDatabaseCacheForTests(): void {
  cachedDatabaseReport = null;
}

export function setDatabaseHealthReport(report: DatabaseHealthReport): void {
  cachedDatabaseReport = report;
}

export function getDatabaseHealthReport(): DatabaseHealthReport | null {
  return cachedDatabaseReport;
}

export function getHealthPayload(): HealthPayload {
  return {
    ok: true,
    version: appVersion(),
    mode: process.env.NODE_ENV ?? "development",
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    ...(cachedDatabaseReport ? { database: cachedDatabaseReport } : {}),
  };
}

export function registerHealthRoute(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.status(200).json(getHealthPayload());
  });
}
