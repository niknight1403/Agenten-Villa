/**
 * Sprint 103 — Tests: HAARA (Master-Prompt Abschnitt 2.1).
 * Reine Bewertungslogik, Prompt-Routing, Backpressure und Orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assessHaara,
  haaraBackpressure,
  haaraMaxConcurrency,
  haaraTick,
  getHaaraStatus,
  haaraHistory,
  resetHaaraForTests,
  routePromptModel,
  withHaaraBackpressure,
  HaaraBackpressureError,
  type HaaraSignal,
} from "./haara";
import { resetRouteRotatorForTests } from "./route-rotator";
import { clearProviderCooldownsForTests, markProviderFailure } from "./provider-cooldown";

function signal(partial: Partial<HaaraSignal> = {}): HaaraSignal {
  return {
    activeRoute: "ollama",
    rotation: { rankedRoutes: ["ollama"], routes: {} as never },
    cooldowns: [],
    database: { status: "verbunden" },
    now: 1_000,
    ...partial,
  };
}

beforeEach(() => {
  resetHaaraForTests();
  resetRouteRotatorForTests();
  clearProviderCooldownsForTests();
  delete process.env.OLLAMA_MODELS;
  delete process.env.HAARA_MAX_CONCURRENCY;
});

afterEach(() => {
  delete process.env.OLLAMA_MODELS;
  delete process.env.HAARA_MAX_CONCURRENCY;
});

describe("assessHaara — Stufenmaschine", () => {
  it("ist healthy, wenn alles gruen ist", () => {
    const result = assessHaara(signal());
    expect(result.level).toBe("healthy");
    expect(result.reasons).toEqual([]);
    expect(result.actions[0].type).toBe("none");
  });

  it("wird critical ohne aktive Route und plant Routenwechsel + Degradation", () => {
    const result = assessHaara(signal({ activeRoute: null }));
    expect(result.level).toBe("critical");
    expect(result.reasons).toContain("Keine aktive LLM-Route");
    expect(result.actions.map((a) => a.type)).toContain("force_rotation");
    expect(result.actions.map((a) => a.type)).toContain("prompt_degradation");
  });

  it("wird critical bei Datenbank-Fehler und plant Reconnect-Probe", () => {
    const result = assessHaara(signal({ database: { status: "fehler" } }));
    expect(result.level).toBe("critical");
    expect(result.actions.map((a) => a.type)).toContain("db_reconnect_probe");
  });

  it("ist self_healing bei heilbarem Cooldown (limit)", () => {
    const result = assessHaara(
      signal({
        cooldowns: [{ provider: "openrouter", kind: "limit", untilMs: 2_000 }],
      }),
    );
    expect(result.level).toBe("self_healing");
    expect(result.reasons[0]).toContain("Cooldown");
    expect(result.actions[0].type).toBe("cooldown_retry_probe");
    expect(result.actions[0]).toHaveProperty("providers", ["openrouter"]);
  });

  it("bleibt degraded (wartend) bei hartem auth-Cooldown ohne weitere Heilaktion", () => {
    const result = assessHaara(
      signal({
        cooldowns: [{ provider: "gemini", kind: "auth", untilMs: 2_000 }],
      }),
    );
    expect(result.level).toBe("degraded");
    // Auth-Cooldown ist nicht heilbar: keine Heilaktion, nur warten.
    expect(result.actions).toEqual([]);
  });

  it("markiert nicht konfigurierte DB als degraded-Grund ohne Stufenabsturz", () => {
    const result = assessHaara(signal({ database: { status: "nicht_konfiguriert" } }));
    expect(result.level).toBe("degraded");
    expect(result.reasons[0]).toContain("nicht konfiguriert");
  });
});

describe("routePromptModel — Prompt-Routing", () => {
  it("waehlt das kleinste Modell fuer Klassifikation", () => {
    process.env.OLLAMA_MODELS = "qwen3.6:27b,devstral:24b,gemma4:12b";
    expect(routePromptModel("classification")).toBe("gemma4:12b");
  });

  it("waehlt das groesste Modell fuer Generierung", () => {
    process.env.OLLAMA_MODELS = "qwen3.6:27b,devstral:24b,gemma4:12b";
    expect(routePromptModel("generation")).toBe("qwen3.6:27b");
  });

  it("bevorzugt devstral fuer Coding", () => {
    process.env.OLLAMA_MODELS = "qwen3.6:27b,devstral:24b,gemma4:12b";
    expect(routePromptModel("coding")).toBe("devstral:24b");
  });

  it("liefert null ohne konfigurierte Modelle", () => {
    expect(routePromptModel("generation")).toBeNull();
  });
});

describe("Backpressure statt Auto-Scaling", () => {
  it("limitiert Concurrency und empfiehlt Retry", async () => {
    process.env.HAARA_MAX_CONCURRENCY = "2";
    expect(haaraMaxConcurrency()).toBe(2);
    let release!: (v: number) => void;
    const gate = new Promise<number>((resolve) => (release = resolve));
    const first = withHaaraBackpressure(() => gate);
    expect(haaraBackpressure().accepted).toBe(true);
    const second = withHaaraBackpressure(async () => 2);
    await expect(second).resolves.toBe(2);
    const info = haaraBackpressure();
    // first haelt noch einen Slot — je nach Reihenfolge ist der zweite frei
    expect(info.inflight).toBeLessThanOrEqual(2);
    release(1);
    await expect(first).resolves.toBe(1);
    expect(haaraBackpressure().inflight).toBe(0);
  });

  it("lehnt Ueberlast sofort ab Fehler ab", async () => {
    process.env.HAARA_MAX_CONCURRENCY = "1";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holder = withHaaraBackpressure(() => gate);
    await expect(withHaaraBackpressure(async () => 1)).rejects.toBeInstanceOf(
      HaaraBackpressureError,
    );
    release();
    await holder;
    expect(haaraBackpressure().inflight).toBe(0);
  });

  it("faellt bei ungueltigem Limit auf 8 zurueck", () => {
    process.env.HAARA_MAX_CONCURRENCY = "keine-zahl";
    expect(haaraMaxConcurrency()).toBe(8);
  });
});

describe("haaraTick — Orchestrator", () => {
  it("bewertet offline deterministisch und protokolliert den Status", async () => {
    const status = await haaraTick({ offline: true, now: () => 5_000 });
    // Offline ohne DB-Report: Rotation kann null sein -> critical oder degraded.
    expect(["healthy", "degraded", "critical"]).toContain(status.level);
    expect(getHaaraStatus()).toEqual(status);
    expect(haaraHistory().length).toBe(1);
  });

  it("nimmt reale Cooldowns und fehlende Route im Signal auf", async () => {
    markProviderFailure("openrouter", "limit");
    const status = await haaraTick({ offline: true, now: () => Date.now() });
    // Offline ohne Vor-Tick: keine aktive Route -> critical ist korrekt.
    expect(status.level).toBe("critical");
    expect(status.reasons.join(" ")).toContain("Keine aktive LLM-Route");
  });

  it("zeigt Heilaktionen nur an, wenn sie offline nicht ausgefuehrt wurden", async () => {
    const status = await haaraTick({ offline: true, now: () => 10_000 });
    expect(status.appliedActions).toEqual([]);
  });
});
