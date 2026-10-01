import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter, type TrpcContext } from "./routers";
import { resetAgentRouterForTests } from "./agent-router";
import { resetProviderGuardianForTests } from "./provider-guardian";
import { resetRouterTelemetryForTests } from "./router-telemetry";
import * as missionStore from "./elite-mission-store";
import * as agentEngine from "./agent-engine";
import {
  AgentRunOutcome,
  agentMetricsSummary,
  instrumentAgentRun,
  recordAgentRun,
  resetAgentMetricsForTests,
} from "./agent-metrics";

afterEach(() => {
  resetAgentMetricsForTests();
  vi.restoreAllMocks();
});

describe("Agentenmetriken (Sprint 048)", () => {
  it("erfasst Laufzeit, Fehler und Ergebnisstatus eines Laufes", async () => {
    const result = await instrumentAgentRun(
      "elite",
      runResult => runResult.completed,
      async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return { completed: true };
      }
    );
    expect(result).toEqual({ completed: true });
    const summary = agentMetricsSummary();
    expect(summary.totals).toEqual({ completed: 1, partial: 0, failed: 0 });
    expect(summary.samples).toBe(1);
    expect(summary.averageDurationMs).toBeGreaterThanOrEqual(5);
    expect(summary.errorsByCode).toEqual([]);
  });

  it("unterscheidet Teilergebnisse und Misserfolge mit Fehlercode", async () => {
    await instrumentAgentRun("elite", () => false, async () => "nur ein Plan");
    await expect(
      instrumentAgentRun("elite", () => true, async () => {
        throw new (class MissionFailed extends Error {
          code = "PRECONDITION_FAILED" as const;
        })();
      })
    ).rejects.toThrow();
    const summary = agentMetricsSummary();
    expect(summary.totals).toEqual({ completed: 0, partial: 1, failed: 1 });
    expect(summary.errorsByCode).toEqual([{ code: "PRECONDITION_FAILED", count: 1 }]);
  });

  it("begrenzt die Historie auf 200 Läufe", () => {
    for (let i = 0; i < 205; i++) {
      recordAgentRun({ kind: "elite", outcome: "completed" as AgentRunOutcome, durationMs: 1 });
    }
    expect(agentMetricsSummary().samples).toBe(200);
    expect(agentMetricsSummary().totals.completed).toBe(200);
  });

  it("meldet leere Metriken ohne Division durch null", () => {
    expect(agentMetricsSummary()).toEqual({
      totals: { completed: 0, partial: 0, failed: 0 },
      errorsByCode: [],
      averageDurationMs: 0,
      samples: 0,
    });
  });
});

function createContext(role: "user" | "admin", email: string): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 17, openId: "test-open-id", email, name: "Test User",
      loginMethod: "test", role, createdAt: now, updatedAt: now, lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Router-Integration der Agentenmetriken (Sprint 048)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GITHUB_TOKEN", "test-token");
  });

  afterEach(() => {
    resetAgentRouterForTests();
    resetProviderGuardianForTests();
    resetRouterTelemetryForTests();
    resetAgentMetricsForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("erfasst eine Elite-Mission als abgeschlossenen Lauf", async () => {
    const caller = appRouter.createCaller(createContext("admin", "admin@example.com"));
    await caller.agent.setState({ state: "RUNNING" });
    vi.spyOn(missionStore, "reserveMission").mockResolvedValue({
      created: true, run: { id: 44, ownerId: "x", status: "running", input: {} },
    } as never);
    vi.spyOn(missionStore, "renewMissionLease").mockResolvedValue(true);
    vi.spyOn(missionStore, "finishMission").mockResolvedValue();
    vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub").mockResolvedValue({
      answer: "Fertig", provider: "openrouter", model: "free", attempts: 1, completed: true,
      branch: "agent/m", githubActions: 2, pullRequestOpened: true, pullRequest: null,
    } as never);
    await caller.agent.eliteMission({ prompt: "Baue das Projekt", history: [], acknowledgeImpact: true });
    const summary = await caller.agent.agentMetrics();
    expect(summary.totals.completed).toBe(1);
    expect(summary.samples).toBe(1);
    expect(summary.averageDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("erfasst einen gescheiterten Lauf mit Fehlercode und meldet Teilergebnisse", async () => {
    const caller = appRouter.createCaller(createContext("admin", "admin@example.com"));
    await caller.agent.setState({ state: "RUNNING" });
    vi.spyOn(missionStore, "reserveMission").mockResolvedValue({
      created: true, run: { id: 45, ownerId: "x", status: "running", input: {} },
    } as never);
    vi.spyOn(missionStore, "renewMissionLease").mockResolvedValue(true);
    vi.spyOn(missionStore, "finishMission").mockResolvedValue();
    vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub").mockRejectedValue(
      Object.assign(new Error("Mission gescheitert"), { code: "BAD_GATEWAY" })
    );
    await expect(caller.agent.eliteMission({ prompt: "Baue das Projekt", history: [], acknowledgeImpact: true }))
      .rejects.toThrow();
    vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub").mockResolvedValue({
      answer: "Nur ein Plan", provider: "openrouter", model: "free", attempts: 1, completed: false,
      branch: null, githubActions: 0, pullRequestOpened: false, pullRequest: null,
    } as never);
    await caller.agent.eliteMission({ prompt: "Anderes Projekt", history: [], acknowledgeImpact: true });
    const summary = await caller.agent.agentMetrics();
    expect(summary.totals).toEqual({ completed: 0, partial: 1, failed: 1 });
    expect(summary.errorsByCode).toEqual([{ code: "BAD_GATEWAY", count: 1 }]);
  });

  it("schützt die Metrikenabfrage für Nicht-Administratoren", async () => {
    const user = appRouter.createCaller(createContext("user", "user@example.com"));
    await expect(user.agent.agentMetrics()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
