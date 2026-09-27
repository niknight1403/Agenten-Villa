import { describe, expect, it } from "vitest";
import {
  CORE_AGENTS,
  LOGICAL_AGENT_CAPACITY,
  getLogicalAgent,
  listLogicalAgents,
  selectCoreAgentsForTask,
} from "./agent-catalog";

describe("agent catalog", () => {
  it("provides exactly 1,000 logical specialist agents", () => {
    expect(LOGICAL_AGENT_CAPACITY).toBe(1_000);
    expect(listLogicalAgents()).toHaveLength(1_000);
  });

  it("uses unique logical agent IDs", () => {
    const ids = listLogicalAgents().map(agent => agent.id);

    expect(new Set(ids).size).toBe(LOGICAL_AGENT_CAPACITY);
  });

  it("maps the first and final logical agent slot", () => {
    expect(getLogicalAgent(1)).toMatchObject({
      id: "logical-1",
      slot: 1,
    });

    expect(getLogicalAgent(1_000)).toMatchObject({
      id: "logical-1000",
      slot: 1_000,
    });
  });

  it("rejects invalid logical agent slots", () => {
    expect(() => getLogicalAgent(0)).toThrow(RangeError);
    expect(() => getLogicalAgent(1_001)).toThrow(RangeError);
    expect(() => getLogicalAgent(1.5)).toThrow(RangeError);
  });

  it("contains the required professional core roles", () => {
    const ids = CORE_AGENTS.map(agent => agent.id);

    expect(ids).toContain("project-manager");
    expect(ids).toContain("software-architect");
    expect(ids).toContain("frontend-engineer");
    expect(ids).toContain("backend-engineer");
    expect(ids).toContain("database-engineer");
    expect(ids).toContain("test-engineer");
    expect(ids).toContain("security-reviewer");
    expect(ids).toContain("github-reviewer");
  });

  it("selects relevant specialists for a technical task", () => {
    const selected = selectCoreAgentsForTask(
      "Erstelle eine sichere tRPC API mit MySQL Migration, Vitest und GitHub Draft-PR."
    );

    const ids = selected.map(agent => agent.id);

    expect(ids).toContain("backend-engineer");
    expect(ids).toContain("database-engineer");
    expect(ids).toContain("test-engineer");
    expect(ids).toContain("github-reviewer");
  });
});
