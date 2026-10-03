import { afterEach, describe, expect, it, vi } from "vitest";
import {
  planChainRecovery,
  waitBudgetMs,
  DEFAULT_WAIT_BUDGET_MS,
  type ChainCooldownSnapshot,
} from "./route-wait";

afterEach(() => {
  vi.unstubAllEnvs();
});

const NOW = 1_000_000;

function baseOverrides(overrides: Partial<ChainCooldownSnapshot> = {}): ChainCooldownSnapshot {
  return {
    provider: "openrouter",
    kind: "limit",
    untilMs: NOW + 5_000,
    ...overrides,
  };
}

describe("Limit-Erholung (Sprint 079)", () => {
  it("startet sofort neu, wenn eine Route wieder frei ist", () => {
    const decision = planChainRecovery({
      chainRuns: 1,
      maxChainRuns: 2,
      waitBudgetMs: 60_000,
      now: NOW,
      routes: ["openrouter", "groq"],
      cooldowns: [baseOverrides({ provider: "openrouter" })],
    });
    expect(decision).toEqual({
      action: "retry-now",
      reason: "Route groq ist wieder frei",
    });
  });

  it("wartet auf das naechste Kontingentfenster, wenn alle Routen kurz gesperrt sind", () => {
    const decision = planChainRecovery({
      chainRuns: 1,
      maxChainRuns: 2,
      waitBudgetMs: 60_000,
      now: NOW,
      routes: ["openrouter", "groq"],
      cooldowns: [
        baseOverrides({ provider: "openrouter", untilMs: NOW + 5_000 }),
        baseOverrides({ provider: "groq", untilMs: NOW + 12_000 }),
      ],
    });
    expect(decision).toEqual({
      action: "wait",
      waitMs: 5_000,
      reason: expect.stringContaining("5 s"),
    });
  });

  it("bricht ehrlich ab, wenn das Fenster ausserhalb des Budgets liegt (Tageskontingent)", () => {
    const decision = planChainRecovery({
      chainRuns: 1,
      maxChainRuns: 2,
      waitBudgetMs: 60_000,
      now: NOW,
      routes: ["openrouter"],
      cooldowns: [baseOverrides({ untilMs: NOW + 3_600_000 })],
    });
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({ reason: expect.stringContaining("ausserhalb des Wartebudgets") });
  });

  it("bricht ohne Endlos-Retry ab, wenn die Erholungslaeufe aufgebraucht sind", () => {
    const decision = planChainRecovery({
      chainRuns: 2,
      maxChainRuns: 2,
      waitBudgetMs: 60_000,
      now: NOW,
      routes: ["openrouter"],
      cooldowns: [baseOverrides()],
    });
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({ reason: expect.stringContaining("kein Endlos-Retry") });
  });

  it("wartet nicht auf Auth-Sperren (30 min ist kein Rotationsfall)", () => {
    const decision = planChainRecovery({
      chainRuns: 1,
      maxChainRuns: 2,
      waitBudgetMs: 60_000,
      now: NOW,
      routes: ["openrouter"],
      cooldowns: [baseOverrides({ kind: "auth", untilMs: NOW + 1_800_000 })],
    });
    expect(decision.action).toBe("fail");
  });

  it("ignoriert abgelaufene Sperren und startet sofort neu", () => {
    const decision = planChainRecovery({
      chainRuns: 1,
      maxChainRuns: 2,
      waitBudgetMs: 60_000,
      now: NOW,
      routes: ["openrouter"],
      cooldowns: [baseOverrides({ untilMs: NOW - 1 })],
    });
    expect(decision.action).toBe("retry-now");
  });

  it("liest das Wartebudget begrenzt aus der Umgebung", () => {
    vi.stubEnv("ROUTE_WAIT_BUDGET_MS", "999999");
    expect(waitBudgetMs()).toBe(300_000);
    vi.stubEnv("ROUTE_WAIT_BUDGET_MS", "5000");
    expect(waitBudgetMs()).toBe(5_000);
    vi.stubEnv("ROUTE_WAIT_BUDGET_MS", "keine-zahl");
    expect(waitBudgetMs()).toBe(DEFAULT_WAIT_BUDGET_MS);
  });

  it("betrachtet Timeout-Sperren als kurz und wartewuerdig", () => {
    const decision = planChainRecovery({
      chainRuns: 1,
      maxChainRuns: 2,
      waitBudgetMs: 60_000,
      now: NOW,
      routes: ["openrouter"],
      cooldowns: [baseOverrides({ kind: "timeout", untilMs: NOW + 3_000 })],
    });
    expect(decision).toEqual({ action: "wait", waitMs: 3_000, reason: expect.any(String) });
  });
});
