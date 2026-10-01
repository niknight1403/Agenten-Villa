import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_GATES, approvalPoint, requireApproval } from "./approval-gates";
import { appRouter } from "./routers";
import type { TrpcContext } from "./routers";

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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("GITHUB_TOKEN", "test-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Freigabepunkte (Sprint 047)", () => {
  it("führt jeden risikorechten Einstieg als markierten Freigabepunkt", () => {
    const ids = APPROVAL_GATES.map(gate => gate.id);
    expect(ids).toEqual(["mission-start", "mission-restart", "controller-stop"]);
    for (const gate of APPROVAL_GATES) {
      expect(approvalPoint(gate.id)).toBe(gate);
      expect(gate.description.length).toBeGreaterThan(20);
      expect(gate.acknowledgement.length).toBeGreaterThan(20);
    }
    expect(() => approvalPoint("unbekannt")).toThrow(/UNBEKANNTER_FREIGABEPUNKT/);
  });

  it("requireApproval lehnt ohne Quittung mit klarem Text ab", () => {
    expect(() => requireApproval("mission-start", false)).toThrowError(/Elite-Mission starten/);
    expect(() => requireApproval("controller-stop", false)).toThrowError(/Agentenbetrieb anhalten/);
    expect(() => requireApproval("mission-restart", true)).not.toThrow();
  });

  it("verweigert den Missionsstart ohne ausdrückliche Freigabe", async () => {
    const caller = appRouter.createCaller(createContext("admin", "admin@example.com"));
    const error = await caller.agent.eliteMission({
      prompt: "Baue das Projekt",
      history: [],
      acknowledgeImpact: false as never,
    }).catch(e => e);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("Elite-Mission starten");
  });

  it("verweigert das Anhalten des Agentenbetriebs ohne Quittung", async () => {
    const caller = appRouter.createCaller(createContext("admin", "admin@example.com"));
    await expect(caller.agent.setState({ state: "RUNNING" }))
      .resolves.toEqual({ state: "RUNNING" });
    const error = await caller.agent.setState({ state: "STOPPED" }).catch(e => e);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("Agentenbetrieb anhalten");
    await expect(caller.agent.setState({ state: "STOPPED", acknowledgeStop: true }))
      .resolves.toEqual({ state: "STOPPED" });
    // Nicht-Administratoren sehen weiterhin FORBIDDEN vor der Freigabeprüfung.
    const user = appRouter.createCaller(createContext("user", "user@example.com"));
    await expect(user.agent.setState({ state: "STOPPED", acknowledgeStop: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
