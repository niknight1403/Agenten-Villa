/**
 * Sprint 092 — Rollenbasierte Dashboards: die sichtbaren Abschnitte
 * pro Rolle sind zentral definiert und ueber den Server abrufbar.
 *
 * Invarianten:
 *  - Viewer sehen Basis-Abschnitte, NIE Admin- oder Operator-Inhalte.
 *  - Operatoren sehen Steuerung (Missions, Controller), nie Admin-Inhalte.
 *  - Administratoren sehen alles — in stabiler Render-Reihenfolge.
 *  - Der tRPC-Endpunkt spiegelt die aufgeloeste Rolle des Aufrufers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { resetAgentRouterForTests } from "./agent-router";
import { resetAgentMetricsForTests } from "./agent-metrics";
import {
  DASHBOARD_SECTIONS,
  dashboardLayoutForRole,
  layoutHasSection,
} from "./dashboard";
import type { TrpcContext } from "./_core/context";

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
  resetAgentMetricsForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Rollenbasierte Dashboards (Sprint 092)", () => {
  it("Viewer sehen nur Basis-Abschnitte — nie Operator- oder Admin-Inhalte", () => {
    const layout = dashboardLayoutForRole("viewer");
    expect(layout.role).toBe("viewer");
    expect(layout.sections).toEqual(["villa_overview", "token_budget", "onboarding"]);
    expect(layoutHasSection(layout, "controller")).toBe(false);
    expect(layoutHasSection(layout, "elite_mission")).toBe(false);
    expect(layoutHasSection(layout, "admin_metrics")).toBe(false);
  });

  it("Operatoren sehen zusätzlich Missions- und Controller-Steuerung", () => {
    const layout = dashboardLayoutForRole("operator");
    expect(layout.sections).toEqual([
      "villa_overview",
      "token_budget",
      "onboarding",
      "villa_mission",
      "controller",
    ]);
    expect(layoutHasSection(layout, "controller")).toBe(true);
    expect(layoutHasSection(layout, "elite_mission")).toBe(false);
  });

  it("Administratoren sehen alle Abschnitte in stabiler Reihenfolge", () => {
    const layout = dashboardLayoutForRole("admin");
    expect(layout.sections).toEqual(DASHBOARD_SECTIONS.map((section) => section.id));
    expect(layout.sections).toContain("elite_mission");
    expect(layout.sections).toContain("admin_metrics");
    expect(layout.sections).toContain("routing");
    expect(layout.sections).toContain("provider_config");
  });

  it("Abschnitte haben keine Duplikate und volle Rollenabdeckung", () => {
    const ids = DASHBOARD_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Jede Rolle hat mindestens einen Abschnitt.
    for (const role of ["viewer", "operator", "admin"] as const) {
      expect(dashboardLayoutForRole(role).sections.length).toBeGreaterThan(0);
    }
  });

  it("layoutHasSection toleriert ungeladene Layouts (undefined)", () => {
    expect(layoutHasSection(undefined, "controller")).toBe(false);
  });

  it("tRPC-Endpunkt agent.dashboard spiegelt die Rolle des Aufrufers", async () => {
    const viewerCaller = appRouter.createCaller(createContext("user", "viewer@example.com"));
    const viewerLayout = await viewerCaller.agent.dashboard();
    expect(viewerLayout.role).toBe("viewer");
    expect(viewerLayout.sections).not.toContain("elite_mission");

    const adminCaller = appRouter.createCaller(createContext("admin", "admin@example.com"));
    const adminLayout = await adminCaller.agent.dashboard();
    expect(adminLayout.role).toBe("admin");
    expect(adminLayout.sections).toContain("elite_mission");
    expect(adminLayout.sections).toContain("routing");
  });

  it("Operator-Allowlist (AGENT_OPERATOR_EMAIL) hebt den Viewer auf Operator-Layout", async () => {
    vi.stubEnv("AGENT_OPERATOR_EMAIL", "ops@example.com");
    const caller = appRouter.createCaller(createContext("user", "ops@example.com"));
    const layout = await caller.agent.dashboard();
    expect(layout.role).toBe("operator");
    expect(layout.sections).toContain("controller");
    expect(layout.sections).not.toContain("admin_metrics");
  });
});
