import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { resetAgentRouterForTests } from "./agent-router";
import type { TrpcContext } from "./_core/context";
import * as missionStore from "./elite-mission-store";
import * as missionDb from "./db";
import * as agentEngine from "./agent-engine";

const prompt = "Erstelle eine konkrete Projektänderung";
const specialty = "Autonomous Product Engineering";
function context(role: "admin" | "user" = "admin"): TrpcContext {
  const now = new Date();
  return { user: { id: 17, openId: "test", name: "Test", email: "admin@example.org", loginMethod: "test", role,
    createdAt: now, updatedAt: now, lastSignedIn: now }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

afterEach(() => { resetAgentRouterForTests(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("durable elite mission boundary", () => {
  it("replays a completed key without starting another provider call even when stopped", async () => {
    const key = randomUUID();
    const requestHash = createHash("sha256").update(JSON.stringify({ villaId: null, prompt, history: [], specialty })).digest("hex");
    const result = { answer: "Fertig", provider: "openrouter", model: "free", completed: true, missionId: 9 };
    vi.spyOn(missionStore, "findMissionByKey").mockResolvedValue({ id: 9, requestHash, status: "completed", result } as never);
    const provider = vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub");
    const caller = appRouter.createCaller(context());
    await expect(caller.agent.eliteMission({ idempotencyKey: key, prompt, history: [], acknowledgeImpact: true }))
      .resolves.toMatchObject(result);
    expect(provider).not.toHaveBeenCalled();
    await expect(caller.agent.eliteMission({ idempotencyKey: key, prompt: "Ein anderes Projekt", history: [], acknowledgeImpact: true }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("requires an explicit acknowledgement before rerunning an interrupted mission", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubEnv("OPENROUTER_API_KEY", "test-model");
    const caller = appRouter.createCaller(context());
    await caller.agent.setState({ state: "RUNNING" });
    const restart = vi.spyOn(missionStore, "restartInterruptedMission").mockResolvedValue({
      id: 6, ownerId: "new-attempt", status: "running",
      input: { prompt, history: [], specialty, mode: "workshop" },
    } as never);
    vi.spyOn(missionStore, "renewMissionLease").mockResolvedValue(true);
    vi.spyOn(missionStore, "finishMission").mockResolvedValue();
    const provider = vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub")
      .mockResolvedValue({ answer: "Entwurf", provider: "openrouter", model: "free", attempts: 1, completed: false } as never);
    await expect(caller.agent.restartInterruptedMission({ id: 6, acknowledgeExternalChanges: false as never }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(restart).not.toHaveBeenCalled();
    await expect(caller.agent.restartInterruptedMission({ id: 6, acknowledgeExternalChanges: true }))
      .resolves.toMatchObject({ missionId: 6 });
    expect(provider).toHaveBeenCalledTimes(1);
    await expect(appRouter.createCaller(context("user")).agent.eliteMissionRuns())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Retry-Regeln (Sprint 045)", () => {
  it("begrenzt Missionswiederholungen auf MAX_MISSION_ATTEMPTS", async () => {
    const { MAX_MISSION_ATTEMPTS, missionRetryExhausted } = await import("./elite-mission-store");
    expect(MAX_MISSION_ATTEMPTS).toBe(3);
    expect(missionRetryExhausted({ attempt: 2 })).toBe(false);
    expect(missionRetryExhausted({ attempt: 3 })).toBe(true);
    expect(missionRetryExhausted({ attempt: 4 })).toBe(true);
  });

  it("lehnt einen Restart nach erschöpftem Wiederholungslimit endgültig ab", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubEnv("OPENROUTER_API_KEY", "test-model");
    const caller = appRouter.createCaller(context());
    await caller.agent.setState({ state: "RUNNING" });
    const restart = vi.spyOn(missionStore, "restartInterruptedMission").mockResolvedValue(undefined);
    vi.spyOn(missionStore, "getMissionRun").mockResolvedValue({
      id: 7, ownerId: "x", status: "interrupted", attempt: 3,
      input: { prompt, history: [], specialty, mode: "workshop" },
    } as never);
    const provider = vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub");
    const error = await caller.agent.restartInterruptedMission({ id: 7, acknowledgeExternalChanges: true })
      .catch(e => e);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain("Wiederholungslimit");
    expect(restart).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it("meldet weiterhin den allgemeinen Konflikt, wenn kein Limit erreicht ist", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubEnv("OPENROUTER_API_KEY", "test-model");
    const caller = appRouter.createCaller(context());
    await caller.agent.setState({ state: "RUNNING" });
    vi.spyOn(missionStore, "restartInterruptedMission").mockResolvedValue(undefined);
    vi.spyOn(missionStore, "getMissionRun").mockResolvedValue(undefined);
    const provider = vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub");
    const error = await caller.agent.restartInterruptedMission({ id: 8, acknowledgeExternalChanges: true })
      .catch(e => e);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toContain("nicht unterbrochen");
    expect(provider).not.toHaveBeenCalled();
  });

  it("laeuft ein Restart mit Restversuchen normal", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubEnv("OPENROUTER_API_KEY", "test-model");
    const caller = appRouter.createCaller(context());
    await caller.agent.setState({ state: "RUNNING" });
    vi.spyOn(missionStore, "restartInterruptedMission").mockResolvedValue({
      id: 9, ownerId: "new-attempt", status: "running", attempt: 2,
      input: { prompt, history: [], specialty, mode: "workshop" },
    } as never);
    vi.spyOn(missionStore, "renewMissionLease").mockResolvedValue(true);
    vi.spyOn(missionStore, "finishMission").mockResolvedValue();
    vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub")
      .mockResolvedValue({ answer: "Entwurf", provider: "openrouter", model: "free", attempts: 1, completed: false } as never);
    await expect(caller.agent.restartInterruptedMission({ id: 9, acknowledgeExternalChanges: true }))
      .resolves.toMatchObject({ missionId: 9 });
  });
});

describe("interrupt sweep throttling (PR-Agent)", () => {
  it("fires the expiry sweep at most once per 30 seconds", async () => {
    missionStore.resetInterruptSweepForTests();
    const sweeps: number[] = [];
    const chain = { set: () => chain, where: () => { sweeps.push(Date.now()); return Promise.resolve(); } };
    vi.spyOn(missionDb, "getDb").mockResolvedValue({ update: () => chain } as never);
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await missionStore.interruptExpiredRuns();
    await missionStore.interruptExpiredRuns();
    expect(sweeps.length).toBe(1);
    vi.setSystemTime(1_000_000 + 30_001);
    await missionStore.interruptExpiredRuns();
    expect(sweeps.length).toBe(2);
    vi.useRealTimers();
    missionStore.resetInterruptSweepForTests();
  });

  it("retries the sweep immediately after a failure instead of waiting 30 s", async () => {
    missionStore.resetInterruptSweepForTests();
    const attempts: number[] = [];
    const failingChain = { set: () => failingChain, where: () => { attempts.push(Date.now()); return Promise.reject(new Error("DB weg")); } };
    vi.spyOn(missionDb, "getDb").mockResolvedValue({ update: () => failingChain } as never);
    await expect(missionStore.interruptExpiredRuns()).rejects.toThrow("DB weg");
    // Nach dem Fehlschlag darf das Zeitfenster nicht blockiert sein:
    await expect(missionStore.interruptExpiredRuns()).rejects.toThrow("DB weg");
    expect(attempts.length).toBe(2);
    missionStore.resetInterruptSweepForTests();
  });
});
