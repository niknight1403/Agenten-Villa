import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appVersion,
  getHealthPayload,
  resetVersionCacheForTests,
  resetControllerStateSourceForTests,
  setControllerStateSource,
} from "./_core/health";
import { clearProviderCooldownsForTests, markProviderFailure } from "./provider-cooldown";
import type { ControllerState } from "./controller";

afterEach(() => {
  resetVersionCacheForTests();
  resetControllerStateSourceForTests();
  clearProviderCooldownsForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("health endpoint", () => {
  it("liefert ein positives Payload mit Version, Modus und Uptime", () => {
    const payload = getHealthPayload();
    expect(payload.ok).toBe(true);
    expect(payload.version).toMatch(/[0-9]+\.[0-9]+\.[0-9]+/);
    expect(payload.mode).toBeTypeOf("string");
    expect(payload.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });

  it("liest die Version aus package.json des Arbeitsverzeichnisses", () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(process.cwd());
    expect(appVersion()).toBe(appVersion()); // stabiler Cache
    expect(spy).toHaveBeenCalled();
  });

  it("faellt auf 'unknown' zurueck, wenn package.json fehlt", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/definitiv-nicht-vorhanden");
    resetVersionCacheForTests();
    expect(appVersion()).toBe("unknown");
  });
});


describe("Health: LLM-Anbieter-Zusammenfassung (Sprint 076)", () => {
  it("meldet konfigurierte Anbieter und laesst unkonfigurierte ehrlich aus", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    const providers = getHealthPayload().providers;
    const openrouter = providers.find(entry => entry.name === "openrouter");
    const groq = providers.find(entry => entry.name === "groq");
    const gemini = providers.find(entry => entry.name === "gemini");
    expect(openrouter).toMatchObject({ configured: true, cooldown: false });
    expect(groq).toMatchObject({ configured: true, cooldown: false });
    expect(gemini).toMatchObject({ configured: false, cooldown: false });
  });

  it("zeigt aktive Cooldowns (z. B. nach Kontingent-Erschoepfung)", () => {
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    markProviderFailure("groq", "limit", 300);
    const groq = getHealthPayload().providers.find(
      entry => entry.name === "groq"
    );
    expect(groq).toMatchObject({ configured: true, cooldown: true });
  });
});

describe("Health: Controller-Live-Status (Sprint 076)", () => {
  it("nimmt den Watchdog-Controller-Zustand ueber die gesetzte Quelle auf", () => {
    const state: ControllerState = {
      status: "RUNNING",
      startedAt: "2026-10-03T19:00:00.000Z",
      stoppedAt: null,
      activeWorkers: 3,
      savedAt: null,
      tickCount: 42,
      lastTickAt: "2026-10-03T19:42:00.000Z",
      lastReport: null,
    };
    setControllerStateSource(() => state);
    expect(getHealthPayload().controller).toEqual({
      status: "RUNNING",
      activeWorkers: 3,
      tickCount: 42,
      lastTickAt: "2026-10-03T19:42:00.000Z",
    });
  });

  it("bleibt auch ohne Quelle und bei Fehler der Quelle stoerfrei", () => {
    expect(getHealthPayload().controller).toBeUndefined();
    setControllerStateSource(() => {
      throw new Error("Zustand gerade nicht lesbar");
    });
    expect(getHealthPayload().controller).toBeUndefined();
    expect(getHealthPayload().ok).toBe(true);
  });
});
