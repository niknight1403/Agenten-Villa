import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { agentControlLimits, consumeTurnForTests, isAgentAdminForTests, resetAgentRouterForTests } from "./agent-router";

afterEach(() => { resetAgentRouterForTests(); vi.unstubAllEnvs(); });

describe("agent access controls", () => {
  it("allows only admin role or the configured OAuth email", () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "admin@example.com");
    expect(isAgentAdminForTests({ role: "user", email: "ADMIN@example.com" })).toBe(true);
    expect(isAgentAdminForTests({ role: "user", email: "other@example.com" })).toBe(false);
    expect(isAgentAdminForTests({ role: "admin" })).toBe(true);
  });

  it("enforces a finite per-user hourly request limit", () => {
    for (let i = 0; i < agentControlLimits.maxTurnsPerWindow; i += 1) consumeTurnForTests(7);
    expect(() => consumeTurnForTests(7)).toThrow(TRPCError);
    expect(() => consumeTurnForTests(8)).not.toThrow();
  });
});
