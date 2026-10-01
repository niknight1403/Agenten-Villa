import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentRole, requireRole, roleAtLeast } from "./roles";
import { TRPCError } from "@trpc/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Rollenmodell: Administrator, Operator, Viewer (Sprint 051)", () => {
  it("trennt die drei Rollen nach Datensatz und Allowlist", () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "chef@example.com");
    vi.stubEnv("AGENT_OPERATOR_EMAIL", "ops@example.com");
    expect(resolveAgentRole({ role: "user", email: "a@example.com" })).toBe("viewer");
    expect(resolveAgentRole({ role: "operator", email: "a@example.com" })).toBe("operator");
    expect(resolveAgentRole({ role: "operator", email: "ops@example.com" })).toBe("operator");
    expect(resolveAgentRole({ role: "admin", email: "a@example.com" })).toBe("admin");
    expect(resolveAgentRole({ role: "user", email: "chef@example.com" })).toBe("admin");
    expect(resolveAgentRole({ role: "user", email: null })).toBe("viewer");
  });

  it("stuft Rollen nur aufwärts und prüft Mindestrollen korrekt", () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    const viewer = { role: "user", email: "v@example.com" } as const;
    const operator = { role: "operator", email: "o@example.com" } as const;
    const admin = { role: "admin", email: "c@example.com" } as const;
    expect(roleAtLeast(viewer, "viewer")).toBe(true);
    expect(roleAtLeast(viewer, "operator")).toBe(false);
    expect(roleAtLeast(operator, "operator")).toBe(true);
    expect(roleAtLeast(operator, "admin")).toBe(false);
    expect(roleAtLeast(admin, "admin")).toBe(true);
  });

  it("weist Unterschreitungen mit FORBIDDEN und Klartext ab", () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    const viewer = { role: "user", email: "v@example.com" } as const;
    expect(() => requireRole(viewer, "operator")).toThrow(TRPCError);
    expect(() => requireRole(viewer, "operator")).toThrow(/Operator oder Administrator/);
    expect(() => requireRole(viewer, "operator")).toThrow(/aktuelle Rolle: viewer/);
    const operator = { role: "operator", email: "o@example.com" } as const;
    expect(() => requireRole(operator, "admin")).toThrow(/Administrator/);
    expect(() => requireRole(operator, "operator")).not.toThrow();
  });
});

import { appRouter } from "./routers";
import { resetAgentRouterForTests } from "./agent-router";
import type { TrpcContext } from "./_core/context";

function ctx(role: "user" | "admin" | "operator", email: string): TrpcContext {
  return {
    user: {
      id: 17,
      openId: "test-open-id",
      email,
      name: "Test User",
      loginMethod: "test",
      role,
      createdAt: new Date(),
    },
  } as unknown as TrpcContext;
}

afterEach(() => {
  resetAgentRouterForTests();
});

describe("Rollenmodell am Router (Sprint 051)", () => {
  it("lässt Operatoren den Agenten starten, Viewer aber nicht", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    const operator = appRouter.createCaller(ctx("operator", "ops@example.com"));
    const result = await operator.agent.setState({
      state: "RUNNING",
      acknowledgeStop: true,
      reason: "Operatoren-Schicht beginnt",
    });
    expect(result.state).toBe("RUNNING");
    const viewer = appRouter.createCaller(ctx("user", "viewer@example.com"));
    await expect(
      viewer.agent.setState({ state: "RUNNING", acknowledgeStop: true, reason: "x" })
    ).rejects.toThrow(/Operator oder Administrator/);
  });

  it("hält Operatoren von Administrator-Endpunkten fern", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    const operator = appRouter.createCaller(ctx("operator", "ops@example.com"));
    await expect(operator.agent.setSystemPrompt({ prompt: "x" })).rejects.toThrow(
      /Nur der konfigurierte Administrator/
    );
    await expect(operator.agent.agentMetrics()).rejects.toThrow(
      /Nur der konfigurierte Administrator/
    );
    const admin = appRouter.createCaller(ctx("admin", "chef@example.com"));
    await expect(admin.agent.setSystemPrompt({ prompt: "Ok" })).resolves.toMatchObject({
      systemPrompt: "Ok",
    });
  });

  it("weist im Status die wirksame Rolle und die Steuerrechte aus", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    vi.stubEnv("AGENT_OPERATOR_EMAIL", "ops@example.com");
    const status = await appRouter
      .createCaller(ctx("operator", "ops@example.com"))
      .agent.status();
    expect(status.role).toBe("operator");
    expect(status.canControl).toBe(true);
    expect(status.isAdmin).toBe(false);
    const viewerStatus = await appRouter
      .createCaller(ctx("user", "viewer@example.com"))
      .agent.status();
    expect(viewerStatus.role).toBe("viewer");
    expect(viewerStatus.canControl).toBe(false);
  });
});
