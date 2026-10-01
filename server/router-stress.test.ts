/**
 * Sprint 039 — Router-Stresstest: Hohe lokale Mock-Last bleibt stabil und
 * sicher. Alle Lastspitzen laufen gegen gemockte Provider; kein echter
 * Netzwerkverkehr. Geprüft wird, dass Begrenzungen (Fenster, Budgets,
 * Telemetrie-Speicher, Cooldown) auch unter Nebenläufigkeit exakt halten
 * und kein Aufruf unkontrolliert durchrutscht oder ungefangen ablehnt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, resetProviderChainForTests, runAgentTurn } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";
import {
  agentControlLimits,
  consumeTurnForTests,
  resetAgentRouterForTests,
} from "./agent-router";
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetProviderGuardianForTests();
  resetProviderChainForTests();
  resetAgentRouterForTests();
  resetRouterTelemetryForTests();
});

describe("Router-Stresstest (Sprint 039)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
  });

  it("führt 100 nebenläufige Turns mit gemischten Ergebnissen deterministisch aus", async () => {
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      calls += 1;
      // Jeder vierte Aufruf scheitert mit 429 — Failover muss stabil greifen.
      return calls % 4 === 0 ? limitReply() : reply(200);
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        runAgentTurn(input(i), false, { fetcher })
      )
    );
    // Jeder Turn endet kontrolliert: erfüllt oder ein Terminalfehler
    // als AgentError — niemals ein unkontrollierter Absturz.
    for (const outcome of outcomes) {
      if (outcome.status === "rejected")
        expect(outcome.reason).toBeInstanceOf(AgentError);
      else expect(outcome.value.answer).toContain("Ziel");
    }
    expect(outcomes.filter(o => o.status === "fulfilled").length).toBeGreaterThanOrEqual(80);
    // Die Kette bleibt begrenzt: grob oben durch Versuche-deckel geprüft;
    // hier reicht die Stabilität ohne Endlos-Retry.
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
    // Es darf nur kontrolliert scheitern: Terminalfehler sind AgentError.
    for (const outcome of outcomes) {
      if (outcome.status === "rejected")
        expect(outcome.reason).toBeInstanceOf(AgentError);
    }
    // Mindestens ein Teil erfolgreich — Failover funktioniert unter Last.
    expect(outcomes.some(o => o.status === "fulfilled")).toBe(true);
  });
});
