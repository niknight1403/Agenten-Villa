import { readFileSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import type { DatabaseHealthReport } from "../db-health";
import { fallbackOrder, type ProviderName } from "../provider-registry";
import { providerInCooldown } from "../provider-cooldown";
import type { ControllerState } from "../controller";

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
  /** Sprint 076: Live-Status des 24/7-Watchdog-Controllers (nie blockierend). */
  controller?: {
    status: ControllerState["status"];
    activeWorkers: number;
    tickCount: number;
    lastTickAt: string | null;
  };
  /** Sprint 076: Konfigurations- und Cooldown-Zusammenfassung der LLM-Anbieter. */
  providers: ProviderHealthSummary[];
};

/** Sprint 076 — Anbieterzusammenfassung ohne Secrets und ohne Netzprobe. */
export type ProviderHealthSummary = {
  name: ProviderName;
  configured: boolean;
  cooldown: boolean;
};

const PROVIDER_KEY_ENV: Record<ProviderName, string> = {
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  huggingface: "HF_TOKEN",
};

function providerSummaries(): ProviderHealthSummary[] {
  return fallbackOrder().map(name => ({
    name,
    configured: Boolean(process.env[PROVIDER_KEY_ENV[name]]?.trim()),
    cooldown: providerInCooldown(name),
  }));
}

let controllerStateSource: (() => ControllerState | null) | null = null;

/**
 * Sprint 076 — der Einstiegspunkt setzt hier seinen Live-Getter fuer den
 * Controller-Zustand; der Health-Endpoint liest ihn nur noch ab und bleibt
 * dadurch entkoppelt und nie blockierend.
 */
export function setControllerStateSource(
  source: (() => ControllerState | null) | null
): void {
  controllerStateSource = source;
}

/** Nur fuer Tests: Controller-Quelle zuruecksetzen. */
export function resetControllerStateSourceForTests(): void {
  controllerStateSource = null;
}

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
  const controllerState = (() => {
    try {
      return controllerStateSource?.() ?? null;
    } catch {
      return null;
    }
  })();
  return {
    ok: true,
    version: appVersion(),
    mode: process.env.NODE_ENV ?? "development",
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    providers: providerSummaries(),
    ...(cachedDatabaseReport ? { database: cachedDatabaseReport } : {}),
    ...(controllerState
      ? {
          controller: {
            status: controllerState.status,
            activeWorkers: controllerState.activeWorkers,
            tickCount: controllerState.tickCount,
            lastTickAt: controllerState.lastTickAt,
          },
        }
      : {}),
  };
}

export function registerHealthRoute(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.status(200).json(getHealthPayload());
  });
}
