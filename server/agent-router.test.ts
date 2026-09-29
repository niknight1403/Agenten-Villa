import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import * as villaStore from "./villa-store";
import * as agentEngine from "./agent-engine";
import * as missionStore from "./elite-mission-store";
import type { TrpcContext } from "./_core/context";
import {
  agentControlLimits,
  consumeCredentialCheckForTests,
  consumeGitHubTurnForTests,
  consumeTurnForTests,
  credentialCheckLimits,
  githubControlLimits,
  isAgentAdminForTests,
  remainingInWindow,
  resetAgentRouterForTests,
} from "./agent-router";
import { resetProviderGuardianForTests } from "./provider-guardian";

function createContext(role: "user" | "admin", email: string): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 17,
      openId: "test-open-id",
      email,
      name: "Test User",
      loginMethod: "test",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => {
  resetAgentRouterForTests();
  resetProviderGuardianForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("agent access controls", () => {
  it("binds an elite mission to the administrator's own project villa", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-model-key");
    vi.stubEnv("GITHUB_TOKEN", "test-github-key");
    const caller = appRouter.createCaller(createContext("admin", "admin@example.com"));
    await caller.agent.setState({ state: "RUNNING" });
    const villa = vi.spyOn(villaStore, "getVilla").mockResolvedValue(undefined);
    vi.spyOn(missionStore, "reserveMission").mockResolvedValue({
      created: true,
      run: { id: 22, ownerId: "test-owner", status: "running" } as never,
    });
    vi.spyOn(missionStore, "renewMissionLease").mockResolvedValue(true);
    vi.spyOn(missionStore, "finishMission").mockResolvedValue();
    const mission = vi.spyOn(agentEngine, "runAutonomousProjectWithGitHub").mockResolvedValue({ answer: "Entwurf", provider: "openrouter", model: "free", attempts: 1, completed: false, branch: null, pullRequest: null, githubActions: 0 });
    await expect(caller.agent.eliteMission({ villaId: 91, prompt: "Baue das Projekt", history: [] }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mission).not.toHaveBeenCalled();
    villa.mockResolvedValue({ id: 9, createdBy: 17, name: "Projektvilla", specialty: "Projekt", projectBrief: "Android-Dateimanager", icon: "villa", createdAt: new Date(), updatedAt: new Date() });
    await caller.agent.eliteMission({ villaId: 9, prompt: "Baue das Projekt", history: [] });
    expect(villa).toHaveBeenCalledWith(9, 17);
    expect(mission).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("Android-Dateimanager") }), expect.any(Function), expect.any(Object));
  });
  it("allows only admin role or the configured OAuth email", () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    expect(
      isAgentAdminForTests({ role: "user", email: "ADMIN@example.com" })
    ).toBe(true);
    expect(
      isAgentAdminForTests({ role: "user", email: "other@example.com" })
    ).toBe(false);
    expect(isAgentAdminForTests({ role: "admin" })).toBe(true);
  });

  it("enforces finite per-user hourly limits for chats and GitHub calls", () => {
    for (let i = 0; i < agentControlLimits.maxTurnsPerWindow; i += 1)
      consumeTurnForTests(7);
    expect(() => consumeTurnForTests(7)).toThrow(TRPCError);
    expect(() => consumeTurnForTests(8)).not.toThrow();
    for (let i = 0; i < githubControlLimits.maxTurnsPerWindow; i += 1)
      consumeGitHubTurnForTests(7);
    expect(() => consumeGitHubTurnForTests(7)).toThrow(TRPCError);
    expect(githubControlLimits.maxTurnsPerWindow).toBe(12);
  });

  it("limits admin API-key checks independently to five per fifteen minutes", () => {
    for (let i = 0; i < credentialCheckLimits.maxChecks; i += 1)
      consumeCredentialCheckForTests(7);
    expect(() => consumeCredentialCheckForTests(7)).toThrow(TRPCError);
    expect(() => consumeCredentialCheckForTests(8)).not.toThrow();
    expect(credentialCheckLimits.windowMs).toBe(15 * 60 * 1000);
  });

  it("blocks non-admin GitHub requests before any provider or repository request", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("OPENROUTER_API_KEY", "test-model-key");
    vi.stubEnv("GITHUB_TOKEN", "test-github-key");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const admin = appRouter.createCaller(
      createContext("admin", "admin@example.com")
    );
    await admin.agent.setState({ state: "RUNNING" });
    const caller = appRouter.createCaller(
      createContext("user", "other@example.com")
    );
    await expect(
      caller.agent.chat({
        prompt: "Read the repo",
        history: [],
        mode: "workshop",
        specialty: "Generalist",
        useGitHub: true,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires the GitHub server secret before an admin GitHub run", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("OPENROUTER_API_KEY", "test-model-key");
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const caller = appRouter.createCaller(
      createContext("user", "admin@example.com")
    );
    await caller.agent.setState({ state: "RUNNING" });
    await expect(
      caller.agent.chat({
        prompt: "List the repo",
        history: [],
        mode: "workshop",
        specialty: "Generalist",
        useGitHub: true,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("blocks a non-admin before an outbound OpenRouter key status request", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const caller = appRouter.createCaller(
      createContext("user", "other@example.com")
    );
    await expect(
      caller.agent.testOpenRouterKey({ apiKey: "sk-or-test-key" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only a validation status to the allowlisted administrator", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const key = "sk-or-secret-test-key";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const caller = appRouter.createCaller(
      createContext("user", "ADMIN@example.com")
    );
    const result = await caller.agent.testOpenRouterKey({ apiKey: key });
    expect(result.status).toBe("valid");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("rate limit window reset", () => {
  it("reopens the window after the configured interval passes", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < agentControlLimits.maxTurnsPerWindow; i += 1)
        consumeTurnForTests(42);
      expect(() => consumeTurnForTests(42)).toThrow(TRPCError);
      vi.advanceTimersByTime(agentControlLimits.windowMs + 1);
      expect(() => consumeTurnForTests(42)).not.toThrow();
      // fresh window started, so the limit applies again
      for (let i = 1; i < agentControlLimits.maxTurnsPerWindow; i += 1)
        consumeTurnForTests(42);
      expect(() => consumeTurnForTests(42)).toThrow(TRPCError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps users in independent windows without cross-talk", () => {
    for (let i = 0; i < agentControlLimits.maxTurnsPerWindow; i += 1)
      consumeTurnForTests(100);
    expect(() => consumeTurnForTests(100)).toThrow(TRPCError);
    expect(() => consumeTurnForTests(101)).not.toThrow();
  });
});

describe("remainingInWindow", () => {
  const limit = 5;
  const windowMs = 1000;
  let store: Map<number, { start: number; count: number }>;

  beforeEach(() => {
    store = new Map();
  });

  it("returns the full limit for fresh and expired windows", () => {
    expect(remainingInWindow(store, 1, limit, windowMs)).toBe(5);
    store.set(1, { start: Date.now() - windowMs - 5, count: 5 });
    expect(remainingInWindow(store, 1, limit, windowMs)).toBe(5);
  });

  it("counts down inside the active window and never goes negative", () => {
    store.set(1, { start: Date.now(), count: 3 });
    expect(remainingInWindow(store, 1, limit, windowMs)).toBe(2);
    store.set(1, { start: Date.now(), count: 9 });
    expect(remainingInWindow(store, 1, limit, windowMs)).toBe(0);
  });
});

describe("admin system prompt configuration", () => {
  it("lets only admins set, read and clear the prompt", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const admin = appRouter.createCaller(
      createContext("admin", "admin@example.com")
    );
    const user = appRouter.createCaller(
      createContext("user", "other@example.com")
    );
    await expect(
      user.agent.setSystemPrompt({ prompt: "nope" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      admin.agent.setSystemPrompt({ prompt: "  Eigenes Admin-Verhalten.  " })
    ).resolves.toMatchObject({ systemPrompt: "Eigenes Admin-Verhalten." });
    await expect(admin.agent.status()).resolves.toMatchObject({
      systemPrompt: "Eigenes Admin-Verhalten.",
    });
    await admin.agent.setSystemPrompt({ prompt: null });
    await expect(admin.agent.status()).resolves.toMatchObject({
      systemPrompt: null,
    });
    await admin.agent.setSystemPrompt({ prompt: "   " });
    await expect(admin.agent.status()).resolves.toMatchObject({
      systemPrompt: null,
    });
  });
});

describe("Mastervillage controller", () => {
  it("starts the assistant by default so chat works after sign-in", async () => {
    const caller = appRouter.createCaller(
      createContext("user", "member@example.com")
    );
    await expect(caller.agent.status()).resolves.toMatchObject({
      state: "RUNNING",
    });
  });

  it("allows the administrator to start and stop the global controller", async () => {
    const caller = appRouter.createCaller(
      createContext("admin", "admin@example.com")
    );
    await expect(caller.agent.setState({ state: "RUNNING" })).resolves.toEqual({
      state: "RUNNING",
    });
    await expect(caller.agent.status()).resolves.toMatchObject({
      state: "RUNNING",
      isAdmin: true,
    });
    await expect(caller.agent.setState({ state: "STOPPED" })).resolves.toEqual({
      state: "STOPPED",
    });
  });
  it("rejects non-administrator controller changes", async () => {
    const caller = appRouter.createCaller(
      createContext("user", "member@example.com")
    );
    await expect(
      caller.agent.setState({ state: "RUNNING" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("provider guardian access and elite unlimited status", () => {
  it("reserves the guardian snapshot and control for the administrator", async () => {
    const member = appRouter.createCaller(
      createContext("user", "member@example.com")
    );
    await expect(member.agent.guardian()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(member.agent.runProviderGuardian()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      member.agent.setProviderGuardian({ enabled: false })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("exposes the autonomous free-route guardian to the administrator", async () => {
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free");
    const admin = appRouter.createCaller(
      createContext("admin", "admin@example.com")
    );
    const snapshot = await admin.agent.guardian();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.freeTierFirst).toBe(true);
    expect(snapshot.configuredChain).toEqual([
      "model-a:free",
      "model-b:free",
    ]);
    expect(snapshot.intervalMs).toBeGreaterThanOrEqual(30_000);
  });

  it("lets the administrator toggle the guardian and reports the new state", async () => {
    const admin = appRouter.createCaller(
      createContext("admin", "admin@example.com")
    );
    await expect(
      admin.agent.setProviderGuardian({ enabled: false })
    ).resolves.toMatchObject({ enabled: false });
    await expect(
      admin.agent.setProviderGuardian({ enabled: true, intervalMs: 60_000 })
    ).resolves.toMatchObject({ enabled: true, intervalMs: 60_000 });
  });

  it("projects the elite unlimited package only to the administrator", async () => {
    const admin = appRouter.createCaller(
      createContext("admin", "admin@example.com")
    );
    const adminStatus = await admin.agent.status();
    expect(adminStatus.eliteUnlimited).toMatchObject({
      localChatQuota: "unlimited",
      localTokenQuota: "unlimited",
      externalProviderQuotasApply: true,
      technicalModelLimitsApply: true,
    });
    expect(adminStatus.providerGuardian?.enabled).toBe(true);

    const member = appRouter.createCaller(
      createContext("user", "member@example.com")
    );
    const memberStatus = await member.agent.status();
    expect(memberStatus.eliteUnlimited).toBeNull();
    expect(memberStatus.providerGuardian).toBeNull();
  });

  it("never claims unlimited external tokens in the elite projection", async () => {
    const admin = appRouter.createCaller(
      createContext("admin", "admin@example.com")
    );
    const status = await admin.agent.status();
    expect(status.eliteUnlimited?.tokenCreation).toBe("provider-defined");
    expect(status.eliteUnlimited?.note).toMatch(/keine Token/);
  });
});
