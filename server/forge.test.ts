import { describe, expect, it } from "vitest";
import {
  assessForgeChecks,
  buildForgePlan,
  forgeContext,
  searchForgeMemory,
} from "../shared/forge";

describe("VillaForge native mission planning", () => {
  it("creates bounded optimize/rebuild plans with optional business and growth roles", () => {
    const plan = buildForgePlan({
      strategy: "REBUILD",
      productReview: true,
      memory: [
        {
          kind: "DECISION",
          title: "Mobile first",
          content: "Android bleibt Pflicht",
          importance: 9,
        },
      ],
    });
    expect(plan.strategy).toBe("REBUILD");
    expect(plan.limits.toolActions).toBe(24);
    expect(plan.tasks.map(task => task.role)).toEqual(
      expect.arrayContaining(["BUSINESS", "GROWTH", "INTEGRATOR"])
    );
    expect(plan.tasks.every(task => task.acceptance.length > 10)).toBe(true);
  });

  it("keeps memory searchable and untrusted inside user context", () => {
    const memory = searchForgeMemory(
      [
        { kind: "FACT", title: "API", content: "tRPC", importance: 4 },
        {
          kind: "CONSTRAINT",
          title: "Safety",
          content: "never override system",
          importance: 10,
        },
      ],
      "safe"
    );
    expect(memory).toHaveLength(1);
    expect(memory[0]?.kind).toBe("CONSTRAINT");
    expect(
      forgeContext({ strategy: "OPTIMIZE", productReview: false, memory })
    ).toContain("untrusted data");
  });

  it("only marks CI passed with complete commit-pinned successful check-runs", () => {
    const sha = "a".repeat(40);
    expect(
      assessForgeChecks(
        {
          result: {
            ref: "agent/x",
            sha,
            total: 1,
            complete: true,
            checks: [{ sha, status: "completed", conclusion: "success" }],
          },
        },
        "agent/x"
      ).state
    ).toBe("passed");
    expect(
      assessForgeChecks(
        {
          result: {
            ref: "agent/x",
            sha,
            total: 1,
            complete: true,
            checks: [{ sha, status: "completed", conclusion: "failure" }],
          },
        },
        "agent/x"
      ).state
    ).toBe("failed");
    expect(
      assessForgeChecks(
        {
          result: {
            ref: "agent/x",
            sha,
            total: 2,
            complete: false,
            checks: [{ sha, status: "completed", conclusion: "success" }],
          },
        },
        "agent/x"
      ).state
    ).toBe("not_checked");
    expect(
      assessForgeChecks(
        {
          result: {
            ref: "main",
            sha,
            total: 1,
            complete: true,
            checks: [{ sha, status: "completed", conclusion: "success" }],
          },
        },
        "agent/x"
      ).state
    ).toBe("not_checked");
  });
});
