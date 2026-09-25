import { describe, expect, it } from "vitest";
import { createTestFixtures, resetTestFixtures } from "./test-fixtures";

describe("deterministic local test fixtures", () => {
  it("creates the same stable villa and agent identifiers every time", () => {
    const first = createTestFixtures();
    const second = createTestFixtures();
    expect(first).toEqual(second);
    expect(first.villas[0]).toMatchObject({
      id: "fixture-villa-01",
      capacity: 5000,
    });
    expect(first.agents.map(agent => agent.id)).toEqual([
      "fixture-agent-01",
      "fixture-agent-02",
      "fixture-agent-03",
    ]);
  });

  it("resets fixture collections without touching unrelated state", () => {
    const fixtures = createTestFixtures();
    resetTestFixtures(fixtures);
    expect(fixtures).toEqual({ villas: [], agents: [] });
  });
});
