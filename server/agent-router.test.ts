import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { agentControlLimits, consumeCredentialCheckForTests, consumeGitHubTurnForTests, consumeTurnForTests, credentialCheckLimits, githubControlLimits, isAgentAdminForTests, resetAgentRouterForTests } from "./agent-router";

function createContext(role: "user" | "admin", email: string): TrpcContext {
  const now = new Date();
  return { user: { id: 17, openId: "test-open-id", email, name: "Test User", loginMethod: "test", role, createdAt: now, updatedAt: now, lastSignedIn: now }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

afterEach(() => { resetAgentRouterForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("agent access controls", () => {
  it("allows only admin role or the configured OAuth email", () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    expect(isAgentAdminForTests({ role: "user", email: "ADMIN@example.com" })).toBe(true);
    expect(isAgentAdminForTests({ role: "user", email: "other@example.com" })).toBe(false);
    expect(isAgentAdminForTests({ role: "admin" })).toBe(true);
  });

  it("enforces finite per-user hourly limits for chats and GitHub calls", () => {
    for (let i = 0; i < agentControlLimits.maxTurnsPerWindow; i += 1) consumeTurnForTests(7);
    expect(() => consumeTurnForTests(7)).toThrow(TRPCError);
    expect(() => consumeTurnForTests(8)).not.toThrow();
    for (let i = 0; i < githubControlLimits.maxTurnsPerWindow; i += 1) consumeGitHubTurnForTests(7);
    expect(() => consumeGitHubTurnForTests(7)).toThrow(TRPCError);
    expect(githubControlLimits.maxTurnsPerWindow).toBe(12);
  });

  it("limits admin API-key checks independently to five per fifteen minutes", () => {
    for (let i = 0; i < credentialCheckLimits.maxChecks; i += 1) consumeCredentialCheckForTests(7);
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
    const admin = appRouter.createCaller(createContext("admin", "admin@example.com"));
    await admin.agent.setState({ state: "RUNNING" });
    const caller = appRouter.createCaller(createContext("user", "other@example.com"));
    await expect(caller.agent.chat({ prompt: "Read the repo", history: [], mode: "workshop", specialty: "Generalist", useGitHub: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires the GitHub server secret before an admin GitHub run", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("OPENROUTER_API_KEY", "test-model-key");
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const caller = appRouter.createCaller(createContext("user", "admin@example.com"));
    await caller.agent.setState({ state: "RUNNING" });
    await expect(caller.agent.chat({ prompt: "List the repo", history: [], mode: "workshop", specialty: "Generalist", useGitHub: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("blocks a non-admin before an outbound OpenRouter key status request", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const caller = appRouter.createCaller(createContext("user", "other@example.com"));
    await expect(caller.agent.testOpenRouterKey({ apiKey: "sk-or-test-key" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only a validation status to the allowlisted administrator", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    const key = "sk-or-secret-test-key";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const caller = appRouter.createCaller(createContext("user", "ADMIN@example.com"));
    const result = await caller.agent.testOpenRouterKey({ apiKey: key });
    expect(result.status).toBe("valid");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
