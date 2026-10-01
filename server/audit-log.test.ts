import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  auditLogSize,
  listAuditEntries,
  recordAuditEntry,
  resetAuditLogForTests,
} from "./audit-log";
import { appRouter } from "./routers";
import { resetAgentRouterForTests } from "./agent-router";
import { resetPromptVersionsForTests } from "./prompt-versions";
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetAuditLogForTests();
  resetAgentRouterForTests();
  resetPromptVersionsForTests();
});

describe("Audit-Log: Zeit, Nutzer und Aktion (Sprint 052)", () => {
  it("zeichnet Einträge mit ISO-Zeitstempel, Nutzer und Aktion auf", () => {
    const entry = recordAuditEntry({
      userId: 17,
      userEmail: "chef@example.com",
      action: "system_prompt_set",
      details: "Systemprompt auf Version 2 gesetzt (geändert).",
      time: new Date("2026-10-01T22:00:00.000Z"),
    });
    expect(entry.time).toBe("2026-10-01T22:00:00.000Z");
    expect(entry.userId).toBe(17);
    expect(entry.userEmail).toBe("chef@example.com");
    expect(entry.action).toBe("system_prompt_set");
    expect(entry.details).toContain("Version 2");
  });

  it("liefert das Log newest-first und begrenzt die Länge", () => {
    for (let i = 0; i < 250; i += 1) {
      recordAuditEntry({
        userId: i,
        userEmail: `u${i}@example.com`,
        action: "controller_state_set",
        details: `Eintrag ${i}`,
      });
    }
    expect(auditLogSize()).toBe(200);
    const entries = listAuditEntries(10);
    expect(entries).toHaveLength(10);
    expect(entries[0].userId).toBe(249);
    expect(entries[9].userId).toBe(240);
    expect(listAuditEntries(500)).toHaveLength(200);
  });

  it("verzeichnet Betriebszustand und Prompt-Änderungen am Router", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    const admin = appRouter.createCaller(ctx("admin", "chef@example.com"));
    await admin.agent.setState({
      state: "RUNNING",
      acknowledgeStop: true,
      reason: "Schichtwechsel",
    });
    await admin.agent.setSystemPrompt({ prompt: "Neuer Prompt" });
    const log = await admin.agent.auditLog({ limit: 10 });
    expect(log.total).toBe(2);
    expect(log.entries[1].action).toBe("controller_state_set");
    expect(log.entries[1].userEmail).toBe("chef@example.com");
    expect(log.entries[0].action).toBe("system_prompt_set");
    expect(log.entries[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("hält Viewer und Operatoren vom Audit-Log fern", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    const operator = appRouter.createCaller(ctx("operator", "ops@example.com"));
    await operator.agent.setState({ state: "RUNNING", acknowledgeStop: true, reason: "x" });
    await expect(operator.agent.auditLog({ limit: 5 })).rejects.toThrow(TRPCError);
    const viewer = appRouter.createCaller(ctx("user", "viewer@example.com"));
    await expect(viewer.agent.auditLog({ limit: 5 })).rejects.toThrow(
      /Nur der konfigurierte Administrator/
    );
  });

  it("verzeichnet auch Rollbacks mit neuer Versionsnummer", async () => {
    vi.stubEnv("AGENT_ADMIN_EMAIL", "");
    const admin = appRouter.createCaller(ctx("admin", "chef@example.com"));
    await admin.agent.setSystemPrompt({ prompt: "Erste Fassung" });
    await admin.agent.setSystemPrompt({ prompt: "Zweite Fassung" });
    await admin.agent.rollbackPromptVersion({ version: 1 });
    const log = await admin.agent.auditLog({ limit: 1 });
    expect(log.entries[0].action).toBe("system_prompt_rollback");
    expect(log.entries[0].details).toContain("Version 1");
  });
});
