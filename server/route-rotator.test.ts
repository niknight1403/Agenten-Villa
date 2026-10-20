import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getRotationStatus,
  pinRoute,
  pickActiveRoute,
  rankRoutes,
  resetRouteRotatorForTests,
  ROUTE_PRIORITY,
  ROUTE_PROFILE,
  runRotationTick,
  unpinRoute,
  type RouteName,
} from "./route-rotator";
import type { ProviderHealthResult } from "./provider-health";

/**
 * Hermetisch: die Netzproben des Rotation-Ticks lesen process.env LIVE
 * (provider-health.ts). Ambient gesetzte Keys (z. B. OPENROUTER_API_KEY in
 * der Shell) wuerden "nichts konfiguriert"-Erwartungen kippen lassen —
 * deshalb in beforeEach neutrales Neutralland, in afterEach zuruecksetzen.
 */
const ROUTE_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "HF_TOKEN",
  "OLLAMA_BASE_URL",
  "OLLAMA_API_KEY",
] as const;

const ok: ProviderHealthResult = { status: "valid", cached: false };
const degraded: ProviderHealthResult = { status: "invalid", cached: false };
const unreachable: ProviderHealthResult = { status: "unavailable", cached: false };

function results(map: Partial<Record<RouteName, ProviderHealthResult | null>>): Record<RouteName, ProviderHealthResult | null> {
  return { ollama: null, openrouter: null, groq: null, gemini: null, huggingface: null, ...map };
}

describe("API-Routen-Rotator (Sprint 102)", () => {
  const originalRouteEnv = Object.fromEntries(
    ROUTE_ENV_KEYS.map((key) => [key, process.env[key]])
  );

  beforeEach(() => {
    resetRouteRotatorForTests();
    for (const key of ROUTE_ENV_KEYS) delete process.env[key];
  });
  afterEach(() => {
    for (const key of ROUTE_ENV_KEYS) {
      const value = originalRouteEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("ordnet Ollama bewusst an erster Stelle (unlimited, Oracle Always Free)", () => {
    expect(ROUTE_PRIORITY[0]).toBe("ollama");
    expect(ROUTE_PROFILE.ollama.cost).toBe("unlimited");
    for (const route of ROUTE_PRIORITY.slice(1)) {
      expect(ROUTE_PROFILE[route].cost).toBe("free");
    }
  });

  it("rangiert gesunde Routen Ollama-first, ungesunde ans Ende", () => {
    const ranked = rankRoutes(
      results({ ollama: ok, openrouter: degraded, groq: unreachable, gemini: ok }),
      null,
    );
    expect(ranked[0]).toBe("ollama");
    expect(ranked[1]).toBe("gemini");
    expect(ranked[2]).toBe("openrouter");
    expect(ranked[3]).toBe("groq");
    expect(ranked).toContain("huggingface");
  });

  it("laesst den Admin-Pin gewinnen (sofern die Route konfiguriert ist)", () => {
    const ranked = rankRoutes(results({ ollama: ok, openrouter: ok }), "openrouter");
    expect(ranked[0]).toBe("openrouter");
  });

  it("ein Admin-Pin auf einer nicht konfigurierten Route wird uebergangen", () => {
    const ranked = rankRoutes(results({ ollama: ok, openrouter: ok }), "groq");
    // Pin gewinnt nur, wenn die Route nicht not_configured ist — groq ist hier
    // nicht konfiguriert und rueckt trotzdem nicht vor Ollama.
    expect(ranked[0]).not.toBe("groq");
  });

  it("waehlt keine Route, wenn nichts konfiguriert ist", () => {
    expect(pickActiveRoute(results({}), null)).toBeNull();
  });

  it("waehlt die gesundeste konfigurierte Route als aktiv", () => {
    expect(pickActiveRoute(results({ ollama: ok, openrouter: ok }), null)).toBe("ollama");
    expect(pickActiveRoute(results({ ollama: unreachable, openrouter: ok }), null)).toBe("openrouter");
    expect(pickActiveRoute(results({ groq: degraded }), null)).toBe("groq");
  });

  it("offline-Tick berechnet Status ohne Netzproben", async () => {
    const status = await runRotationTick({ offline: true, minIntervalMs: 0 });
    expect(status.activeRoute).toBeNull(); // ohne Proben bleibt alles not_configured
    expect(status.routes.ollama.status).toBe("not_configured");
    expect(status.rankedRoutes).toEqual([...ROUTE_PRIORITY]);
  });

  it("Rotation-Tick mit Netzproben: aktive Route und Rangfolge werden gesetzt", async () => {
    // Ollama nicht konfiguriert (kein OLLAMA_BASE_URL), Rest ohne Keys:
    const status = await runRotationTick({ minIntervalMs: 0 });
    expect(status.lastTickAt).toBeGreaterThan(0);
    expect(status.routes.ollama.status).toBe("not_configured");
    expect(status.activeRoute).toBeNull();
  });

  it("Pin/Unpin erscheint im Status", () => {
    pinRoute("openrouter");
    expect(getRotationStatus().pinnedRoute).toBe("openrouter");
    unpinRoute();
    expect(getRotationStatus().pinnedRoute).toBeNull();
  });

  it("respektiert den Mindestabstand zwischen Ticks", async () => {
    let clock = 1_000_000;
    await runRotationTick({ offline: true, now: () => clock, minIntervalMs: 60_000 });
    const afterFirst = getRotationStatus().lastTickAt;
    clock += 1_000;
    await runRotationTick({ offline: true, now: () => clock, minIntervalMs: 60_000 });
    expect(getRotationStatus().lastTickAt).toBe(afterFirst); // zu frueh: kein neuer Tick
  });
});
