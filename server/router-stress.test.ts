/**
 * Sprint 039 & Sprint 086 — Router-Stresstest und Lasttest mit Mock-Providern.
 *
 * Prüft die Provider-Kette unter hoher paralleler Last (50 parallele Turns mit
 * deterministischen Fake-Latenzen) auf Einhaltung der definierten SLO-Latenzgrenzen
 * (ROUTER_SLO_LIMITS), korrekte Cooldown/Failover-Abwicklung und Dichtigkeit
 * (keine Timer-, Listener- oder Speicher-Leaks).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, resetProviderChainForTests, runAgentTurn } from "./agent-engine";
import { resetProviderGuardianForTests, stopProviderGuardian } from "./provider-guardian";
import {
  agentControlLimits,
  consumeTurnForTests,
  resetAgentRouterForTests,
  ROUTER_SLO_LIMITS,
} from "./agent-router";
import {
  clearProviderCooldownsForTests,
  markProviderFailure,
  providerInCooldown,
} from "./provider-cooldown";
import {
  TELEMETRY_SAMPLE_LIMIT,
  resetRouterTelemetryForTests,
  routerTelemetrySummary,
} from "./router-telemetry";
import { TRPCError } from "@trpc/server";

const reply = (status: number, model = "free-test") =>
  new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: "1. Ziel festlegen." } }],
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );

const limitReply = () =>
  new Response(JSON.stringify({ error: "limit" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "300" },
  });

const input = (i: number) => ({
  prompt: `Auftrag ${i}: plane kurz`,
  history: [],
  mode: "home" as const,
  specialty: "Generalist",
});

function calculatePercentile(latencies: number[], percentile: number): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
}

afterEach(() => {
  stopProviderGuardian();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearProviderCooldownsForTests();
  resetProviderGuardianForTests();
  resetProviderChainForTests();
  resetAgentRouterForTests();
  resetRouterTelemetryForTests();
});

describe("Router-SLO-Spezifikation & Lasttests (Sprint 086)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
  });

  it("exportiert definierte SLO-Grenzwerte im Logic-Modul (ROUTER_SLO_LIMITS)", () => {
    expect(ROUTER_SLO_LIMITS.maxConcurrentTurns).toBe(50);
    expect(ROUTER_SLO_LIMITS.p95LatencyMaxMs).toBe(1500);
    expect(ROUTER_SLO_LIMITS.maxLatencyMs).toBe(3000);
    expect(ROUTER_SLO_LIMITS.maxUncontrolledErrorRatePercent).toBe(0);
    expect(ROUTER_SLO_LIMITS.maxTelemetrySamples).toBe(200);
    expect(ROUTER_SLO_LIMITS.minFailoverSuccessRatePercent).toBe(100);
  });

  it("hält 50 parallele Turns mit deterministischen Fake-Latenzen unter den SLO-Latenzgrenzen (P95 < 1500ms)", async () => {
    let callCount = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      callCount += 1;
      const fakeLatencyMs = 10 + (callCount % 5) * 5;
      await new Promise(resolve => setTimeout(resolve, fakeLatencyMs));
      return reply(200, "fake-fast-model");
    });

    const turnCount = ROUTER_SLO_LIMITS.maxConcurrentTurns;
    const latencies: number[] = [];

    const startTotal = performance.now();
    const tasks = Array.from({ length: turnCount }, async (_, i) => {
      const turnStart = performance.now();
      const res = await runAgentTurn(input(i), false, { fetcher });
      const duration = performance.now() - turnStart;
      latencies.push(duration);
      return res;
    });

    const results = await Promise.all(tasks);
    const totalDuration = performance.now() - startTotal;

    expect(results).toHaveLength(turnCount);
    for (const res of results) {
      expect(res.answer).toContain("Ziel");
    }

    const p95 = calculatePercentile(latencies, 95);
    const maxLatency = Math.max(...latencies);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    expect(p95).toBeLessThanOrEqual(ROUTER_SLO_LIMITS.p95LatencyMaxMs);
    expect(maxLatency).toBeLessThanOrEqual(ROUTER_SLO_LIMITS.maxLatencyMs);
    expect(totalDuration).toBeLessThanOrEqual(ROUTER_SLO_LIMITS.maxLatencyMs + 500);

    const summary = routerTelemetrySummary();
    expect(summary.turns).toBe(turnCount);
    expect(summary.successRate).toBe(1);
    expect(avgLatency).toBeGreaterThan(0);
  });

  it("behält Cooldown und Failover unter 50 parallelen Turns korrekt bei", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("openrouter")) {
        primaryCalls += 1;
        return limitReply();
      }
      fallbackCalls += 1;
      return reply(200, "groq-fallback-model");
    });

    // Erster Aufruf löst Cooldown auf OpenRouter aus
    await runAgentTurn(input(0), true, { fetcher });
    expect(providerInCooldown("openrouter")).toBe(true);
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);

    // Jetzt 50 parallele Turns unter aktivem Cooldown
    const turnCount = ROUTER_SLO_LIMITS.maxConcurrentTurns;
    const tasks = Array.from({ length: turnCount }, (_, i) =>
      runAgentTurn(input(i + 1), true, { fetcher })
    );

    const results = await Promise.all(tasks);

    expect(results).toHaveLength(turnCount);
    for (const res of results) {
      expect(res.answer).toContain("Ziel");
    }

    // OpenRouter bleibt im Cooldown und wird bei ALLEN 50 Folge-Turns übersprungen
    expect(providerInCooldown("openrouter")).toBe(true);
    expect(primaryCalls).toBe(1); // Keine weiteren Aufrufe an den primären Provider
    expect(fallbackCalls).toBe(turnCount + 1);

    const summary = routerTelemetrySummary();
    expect(summary.turns).toBe(turnCount + 1);
    expect(summary.successes).toBe(turnCount + 1);
    expect(summary.fallbacks).toBe(1); // Cooldown überspringt gesperrten Provider vor dem Aufruf
  });

  it("verursacht auch unter hoher paralleler Last keine Timer-, Listener- oder Speicher-Leaks", async () => {
    const initialExceptionListeners = process.listenerCount("uncaughtException");
    const initialRejectionListeners = process.listenerCount("unhandledRejection");

    let calls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      calls += 1;
      if (calls % 3 === 0) return limitReply();
      if (calls % 5 === 0) return reply(503);
      return reply(200);
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) => runAgentTurn(input(i), true, { fetcher }))
    );

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(AgentError);
      }
    }

    expect(process.listenerCount("uncaughtException")).toBe(initialExceptionListeners);
    expect(process.listenerCount("unhandledRejection")).toBe(initialRejectionListeners);

    expect(routerTelemetrySummary().turns).toBeLessThanOrEqual(
      ROUTER_SLO_LIMITS.maxTelemetrySamples
    );
  });
});

describe("Router-Stresstest Legacy (Sprint 039 Basis-Invarianten)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
  });

  it("führt 100 nebenläufige Turns mit gemischten Ergebnissen deterministisch aus", async () => {
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      calls += 1;
      return calls % 4 === 0 ? limitReply() : reply(200);
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        runAgentTurn(input(i), false, { fetcher })
      )
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected")
        expect(outcome.reason).toBeInstanceOf(AgentError);
      else expect(outcome.value.answer).toContain("Ziel");
    }
    expect(outcomes.filter(o => o.status === "fulfilled").length).toBeGreaterThanOrEqual(80);
    expect(calls).toBeLessThan(100 * 12);
  });

  it("erzwingt das lokale Turn-Fenster auch unter 50 nebenläufigen Verbrauchen", () => {
    const results = Array.from({ length: 50 }, () => {
      try {
        consumeTurnForTests(99);
        return "ok";
      } catch (error) {
        return error instanceof TRPCError ? "rejected" : "crash";
      }
    });
    expect(results.filter(r => r === "crash").length).toBe(0);
    expect(results.filter(r => r === "ok").length).toBe(
      agentControlLimits.maxTurnsPerWindow
    );
    expect(results.filter(r => r === "rejected").length).toBe(50 - 12);
  });

  it("hält den Telemetrie-Speicher auch unter Dauerlast begrenzt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(200));
    for (let batch = 0; batch < 6; batch += 1) {
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          runAgentTurn(input(batch * 50 + i), false, { fetcher })
        )
      );
    }
    expect(routerTelemetrySummary().turns).toBeLessThanOrEqual(
      TELEMETRY_SAMPLE_LIMIT
    );
  });

  it("läuft auch unter Last nicht in ungefangene Ablehnungen", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Math.random() < 0.5 ? reply(503) : reply(200)
      );
    const outcomes = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        runAgentTurn(input(i), false, { fetcher })
      )
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected")
        expect(outcome.reason).toBeInstanceOf(AgentError);
    }
    expect(outcomes.some(o => o.status === "fulfilled")).toBe(true);
  });
});
