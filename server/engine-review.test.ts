/**
 * Sprint 050 — Engine-Review: bündelt die Invarianten von Engine,
 * Packs und Tool-Sicherheitsgrenzen in einer Regressionssuite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPackCatalog } from "./pack-catalog";
import {
  APPROVAL_GATES,
  approvalPoint,
} from "./approval-gates";
import {
  GITHUB_TOOL_PERMISSIONS,
  authorizeGitHubTool,
} from "./tool-permissions";
import * as agentEngine from "./agent-engine";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Engine-Review (Sprint 050)", () => {
  it("führt jedes Katalog-Pack mit Zweck, Berechtigung und Grenze", () => {
    const catalog = getPackCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const pack of catalog) {
      expect(pack.name.length).toBeGreaterThan(2);
      expect(pack.purpose.length).toBeGreaterThan(10);
      expect(pack.permissions.length).toBeGreaterThan(0);
      expect(pack.limits.length).toBeGreaterThan(0);
    }
  });

  it("verweigert unbekannte Werkzeuge fail-closed", () => {
    const decision = authorizeGitHubTool("github_delete_repo", { branch: "x" }, {
      mode: "workshop", administrator: true, sessionBranches: new Set(["x"]),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("nicht im Berechtigungsregister");
  });

  it("trennt Lese- und Schreibwerkzeuge konsequent", () => {
    for (const permission of GITHUB_TOOL_PERMISSIONS) {
      if (permission.category === "write") {
        expect(permission.requiresAdministrator).toBe(true);
      }
    }
    const readTools = GITHUB_TOOL_PERMISSIONS.filter(p => p.category === "read");
    expect(readTools.length).toBeGreaterThan(3);
  });

  it("erlaubt Schreibwerkzeuge nur mit Administratorrechten und Sitzungs-Branch", () => {
    const context = {
      mode: "workshop" as const,
      administrator: true,
      sessionBranches: new Set(["agent/session"]),
    };
    expect(
      authorizeGitHubTool("github_write_file", { branch: "agent/session" }, context).allowed
    ).toBe(true);
    expect(
      authorizeGitHubTool("github_write_file", { branch: "main" }, context).allowed
    ).toBe(false);
    expect(
      authorizeGitHubTool("github_write_file", { branch: "agent/session" }, { ...context, administrator: false }).allowed
    ).toBe(false);
    expect(
      authorizeGitHubTool("github_read_file", { branch: "main" }, context).allowed
    ).toBe(true);
  });

  it("blockiert GitHub-Werkzeuge außerhalb der Werkstatt", () => {
    const decision = authorizeGitHubTool("github_repo_overview", {}, {
      mode: "home", administrator: true, sessionBranches: new Set(),
    });
    expect(decision.allowed).toBe(false);
  });

  it("markiert jeden risikorechten Einstieg als Freigabepunkt mit Quittungstext", () => {
    expect(APPROVAL_GATES.length).toBe(4);
    for (const gate of APPROVAL_GATES) {
      const point = approvalPoint(gate.id);
      expect(point.id).toBe(gate.id);
      expect(point.acknowledgement.length).toBeGreaterThan(20);
    }
  });

  it("hält die Engine-Grenzen für Werkzeugrunden und GitHub-Aktionen ein", () => {
    // Die harten Grenzen kommen aus den Engine-Limits; sie müssen endlich sein.
    const elite = agentEngine;
    expect(elite.ELITE_LIMITS.githubActionsPerMission).toBeGreaterThan(0);
    expect(elite.ELITE_LIMITS.githubActionsPerMission).toBeLessThanOrEqual(24);
    expect(elite.ELITE_LIMITS.githubToolRounds).toBeLessThanOrEqual(12);
    expect(elite.ELITE_LIMITS.promptChars).toBeGreaterThan(100);
  });
});
