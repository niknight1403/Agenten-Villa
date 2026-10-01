import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";
import { resetAgentRouterForTests } from "./agent-router";
import { resetRouterTelemetryForTests } from "./router-telemetry";
import { resetFreeTierState, cacheEnabled } from "./free-tier";
import { parseAgentInput } from "./agent-schemas";
import { CHAT_CACHE_SCOPE, missionCacheScope, scopedCacheKey } from "./context-isolation";

const reply = (status: number, content = "Antwort A") =>
  new Response(
    JSON.stringify({
      model: "free-test",
      choices: [{ message: { content } }],
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );

const baseInput = {
  prompt: "Plane kurz",
  history: [],
  mode: "home" as const,
  specialty: "Generalist",
};

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("FREE_TIER_CACHE", "1");
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetProviderGuardianForTests();
  resetAgentRouterForTests();
  resetRouterTelemetryForTests();
  resetFreeTierState();
});

describe("Aufgabenkontext-Isolation (Sprint 044)", () => {
  it("namespaced Cache-Schlüssel je Mission; Chat bleibt eigener Scope", () => {
    expect(missionCacheScope("42")).toBe("mission:42");
    expect(missionCacheScope()).toBe(CHAT_CACHE_SCOPE);
    const a = scopedCacheKey(missionCacheScope("1"), "sig");
    const b = scopedCacheKey(missionCacheScope("2"), "sig");
    const chat = scopedCacheKey(missionCacheScope(), "sig");
    expect(new Set([a, b, chat]).size).toBe(3);
  });

  it("behält missionId im Auftragsschema und streift sie nicht ab", () => {
    const parsed = parseAgentInput({ ...baseInput, missionId: " 42 " });
    expect(parsed.missionId).toBe("42");
    expect(cacheEnabled()).toBe(true);
  });

  it("liest keine Cache-Einträge einer anderen Mission (gleiche Anfrage-Signatur)", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(200));
    // Mission 1 schreibt einen Cache-Eintrag …
    await runAgentTurn({ ...baseInput, missionId: "m-1" }, false, { fetcher });
    // … Mission 2 mit identischer Anfrage-Signatur muss selbst rechnen.
    await runAgentTurn({ ...baseInput, missionId: "m-2" }, false, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // … Mission 1 trifft ihren eigenen Cache.
    const cached = await runAgentTurn({ ...baseInput, missionId: "m-1" }, false, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cached.cached).toBe(true);
  });

  it("trennt Chat und Mission: Chat liest keinen Missions-Cache", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(200));
    await runAgentTurn({ ...baseInput, missionId: "m-1" }, false, { fetcher });
    await runAgentTurn(baseInput, false, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("teilt Lauf-Dedupe nur innerhalb derselben Mission", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(200));
    // Zwei identische gleichzeitige Laeufe verschiedener Missionen:
    const [a, b] = await Promise.all([
      runAgentTurn({ ...baseInput, missionId: "m-a" }, false, { fetcher }),
      runAgentTurn({ ...baseInput, missionId: "m-b" }, false, { fetcher }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(a.answer).toBe("Antwort A");
    expect(b.answer).toBe("Antwort A");
    // Dieselbe Mission dedupliziert identische gleichzeitige Anfragen:
    const [, second] = await Promise.all([
      runAgentTurn({ ...baseInput, missionId: "m-a", prompt: "Andere Frage" }, false, { fetcher }),
      runAgentTurn({ ...baseInput, missionId: "m-a", prompt: "Andere Frage" }, false, { fetcher }),
    ]);
    expect(second.cached ?? true).toBeTruthy();
  });
});
