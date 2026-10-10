import { describe, it, expect } from "vitest";
import { engagementRate, scoreThemes, pickTheme, reachPeriod, fanAffinity } from "./reach-engine";

describe("Reach-Engine (Abschnitt 3.2)", () => {
  it("berechnet Engagement-Rate mit Laplace-Glaettung", () => {
    expect(engagementRate(0, 0)).toBe(0);
    expect(engagementRate(100, 5)).toBeGreaterThan(0);
    // 1/1 darf nicht 100 % sein
    expect(engagementRate(1, 1)).toBeLessThan(100);
    expect(engagementRate(10000, 100)).toBeLessThan(engagementRate(100, 5));
  });

  it("scoreThemes sortiert performante Themes nach vorn", () => {
    const scores = scoreThemes([
      { theme: "Schwach", impressions: 10000, engagements: 10 },
      { theme: "Stark", impressions: 1000, engagements: 80 },
      { theme: "Mittel", impressions: 500, engagements: 20 },
    ]);
    expect(scores[0].theme).toBe("Stark");
    expect(scores.every((s) => s.engagementRate >= 0)).toBe(true);
  });

  it("pickTheme nutzt Epsilon-greedy: meist bestes, mit Seed deterministisch", () => {
    const scores = [
      { theme: "A", score: 9, engagementRate: 9 },
      { theme: "B", score: 5, engagementRate: 5 },
    ];
    expect(pickTheme(scores, { epsilon: 0, seed: 1 })).toBe("A");
    expect(pickTheme([], { epsilon: 0.5, seed: 1 })).toBeNull();
    // Determinismus: gleiche Seed → gleiche Wahl
    expect(pickTheme(scores, { epsilon: 0.9, seed: 42 })).toBe(
      pickTheme(scores, { epsilon: 0.9, seed: 42 })
    );
  });

  it("reachPeriod bildet 'YYYY-MM' ab", () => {
    expect(reachPeriod(new Date("2026-10-01T10:00:00Z"))).toBe("2026-10");
    expect(reachPeriod(new Date("2026-01-31T23:00:00Z"))).toBe("2026-01");
  });

  it("fanAffinity ist ehrlich: 0 ohne Follower-Basis", () => {
    expect(fanAffinity(0, 100)).toBe(0);
    expect(fanAffinity(1000, 100)).toBe(10);
  });
});
