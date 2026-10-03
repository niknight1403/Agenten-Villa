import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appVersion,
  getHealthPayload,
  resetVersionCacheForTests,
  resetControllerStateSourceForTests,
  setControllerStateSource,
} from "./_core/health";
import { clearProviderCooldownsForTests, markProviderFailure } from "./provider-cooldown";
import {
  resetRouteOverrideForTests,
  setRouteOverride,
} from "./route-override";
import type { ControllerState } from "./controller";

afterEach(() => {
  resetVersionCacheForTests();
  resetControllerStateSourceForTests();
  clearProviderCooldownsForTests();
  resetRouteOverrideForTests();
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

describe("Health: Ollama-Zusammenfassung (Sprint 080)", () => {
  it("meldet die lokale Route ehrlich: unkonfiguriert ohne Base-URL, konfiguriert mit", () => {
    const withoutBase = getHealthPayload().providers.find(
      entry => entry.name === "ollama"
    );
    expect(withoutBase).toMatchObject({ configured: false, cooldown: false });

    vi.stubEnv("OLLAMA_BASE_URL", "http://mein-host:11434/v1");
    const withBase = getHealthPayload().providers.find(
      entry => entry.name === "ollama"
    );
    expect(withBase).toMatchObject({ configured: true, cooldown: false });
  });
});

describe("Health: Routing-Transparenz (Sprint 079)", () => {
  it("zeigt aktive Route und Cooldown-Details ohne Secrets", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    markProviderFailure("openrouter", "limit", 120);
    const payload = getHealthPayload();
    expect(payload.routing.pinned).toBeNull();
    expect(payload.routing.activeRoute).toBe("groq");
    const openrouter = payload.providers.find(p => p.name === "openrouter");
    expect(openrouter).toMatchObject({ cooldown: true, cooldownKind: "limit" });
    expect(openrouter!.cooldownSecLeft).toBeGreaterThan(0);
  });

  it("zeigt den Admin-Pin ehrlich an, auch wenn er die aktive Route ueberdeckt", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    setRouteOverride("groq", "chef@villa.test");
    const payload = getHealthPayload();
    expect(payload.routing.pinned).toBe("groq");
    expect(payload.routing.pinnedBy).toBe("chef@villa.test");
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
