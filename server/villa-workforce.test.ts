import { describe, expect, it } from "vitest";
import {
  WORKFORCE_DEPARTMENTS,
  WORKFORCE_SIZE,
  describeWorkforce,
  workforceDirective,
  workforceTotal,
} from "../shared/villa-workforce";

describe("Villa-Belegschaft (Sprint: 1000 logische Agenten)", () => {
  it("teilt exakt 1000 logische Agenten auf 10 Abteilungen auf", () => {
    expect(WORKFORCE_SIZE).toBe(1_000);
    expect(WORKFORCE_DEPARTMENTS).toHaveLength(10);
    expect(workforceTotal()).toBe(WORKFORCE_SIZE);
  });

  it("verwendet nur bekannte Forge-Rollen und positive Agentenzahlen", () => {
    const roles = new Set([
      "PLANNER",
      "RESEARCHER",
      "ARCHITECT",
      "CODER",
      "REVIEWER",
      "TESTER",
      "DOCUMENTER",
      "INTEGRATOR",
      "BUSINESS",
      "GROWTH",
    ]);
    for (const department of WORKFORCE_DEPARTMENTS) {
      expect(roles.has(department.role)).toBe(true);
      expect(department.agents).toBeGreaterThan(0);
      expect(department.id).toMatch(/^[a-z]+$/);
      expect(department.name.length).toBeGreaterThan(3);
    }
  });

  it("nennt die Kompaktansicht vollständig und deterministisch", () => {
    const first = describeWorkforce();
    const second = describeWorkforce();
    expect(first).toBe(second);
    for (const department of WORKFORCE_DEPARTMENTS) {
      expect(first).toContain(department.name);
      expect(first).toContain(String(department.agents));
    }
  });

  it("weist den Superagenten zur Einweisung vor der Umsetzung an", () => {
    const directive = workforceDirective("Meine Projekt-Villa");
    expect(directive).toContain("Meine Projekt-Villa");
    expect(directive).toContain("1000 logische Agenten");
    expect(directive).toContain("Einweisung");
    expect(directive).toContain("Aufgabenbereiche");
    // Ohne Villanamen gilt ein neutraler Fallback statt leerem Text.
    expect(workforceDirective(null)).toContain("Projekt-Villa");
    expect(workforceDirective(undefined)).toContain("Projekt-Villa");
  });
});
