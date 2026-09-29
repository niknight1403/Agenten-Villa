import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { resetAgentRouterForTests } from "./agent-router";
import type { TrpcContext } from "./_core/context";
import * as missionStore from "./elite-mission-store";
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
    await expect(caller.agent.eliteMission({ idempotencyKey: key, prompt, history: [] }))
      .resolves.toMatchObject(result);
    expect(provider).not.toHaveBeenCalled();
    await expect(caller.agent.eliteMission({ idempotencyKey: key, prompt: "Ein anderes Projekt", history: [] }))
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
