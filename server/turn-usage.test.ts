import { afterEach, describe, expect, it } from "vitest";
import {
  extractTurnUsage,
  recordTurnUsage,
  resetTurnUsageForTests,
  turnUsageSummary,
  TURN_USAGE_SAMPLE_LIMIT,
} from "./turn-usage";

afterEach(() => {
  resetTurnUsageForTests();
});

describe("Token-Nutzung (Sprint 077)", () => {
  it("extrahiert ein vollstaendiges usage-Objekt einer Completion", () => {
    expect(
      extractTurnUsage({
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      })
    ).toEqual({ promptTokens: 12, completionTokens: 8, totalTokens: 20 });
  });

  it("errechnet total aus der Summe, wenn der Anbieter ihn nicht liefert", () => {
    expect(
      extractTurnUsage({
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      })
    ).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
  });

  it("lehnt fehlendes, unlesbares oder negatives usage ehrlich ab", () => {
    expect(extractTurnUsage({})).toBeNull();
    expect(extractTurnUsage(null)).toBeNull();
    expect(extractTurnUsage({ usage: "viele Tokens" })).toBeNull();
    expect(
      extractTurnUsage({ usage: { prompt_tokens: -4, completion_tokens: "x" } })
    ).toBeNull();
  });

  it("aggregiert Turns und Tokens ueber die Samples", () => {
    recordTurnUsage({
      provider: "groq",
      model: "groq-m",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    recordTurnUsage({
      provider: "openrouter",
      model: "or-m",
      usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
    });
    const summary = turnUsageSummary();
    expect(summary.turns).toBe(2);
    expect(summary.promptTokens).toBe(130);
    expect(summary.completionTokens).toBe(70);
    expect(summary.totalTokens).toBe(200);
    expect(summary.byProvider).toEqual([
      { provider: "groq", turns: 1, totalTokens: 150, estCostMicros: 0 },
      { provider: "openrouter", turns: 1, totalTokens: 50, estCostMicros: 0 },
    ]);
  });

  it("bleibt beim Free-Tier ehrlich bei 0 EUR statt fiktiver Kosten", () => {
    for (let i = 0; i < 10; i++) {
      recordTurnUsage({
        provider: "gemini",
        model: "gemini-m",
        usage: { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
      });
    }
    expect(turnUsageSummary().estCostMicros).toBe(0);
    expect(
      turnUsageSummary().byProvider.every(entry => entry.estCostMicros === 0)
    ).toBe(true);
  });

  it("begrenzt die Historie auf die dokumentierte Sample-Anzahl", () => {
    for (let i = 0; i < TURN_USAGE_SAMPLE_LIMIT + 25; i++) {
      recordTurnUsage({
        provider: "groq",
        model: "groq-m",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    }
    const summary = turnUsageSummary();
    expect(summary.turns).toBe(TURN_USAGE_SAMPLE_LIMIT);
    expect(summary.totalTokens).toBe(TURN_USAGE_SAMPLE_LIMIT * 2);
  });

  it("setzt mit reset den Zustand vollstaendig zurueck", () => {
    recordTurnUsage({
      provider: "groq",
      model: "groq-m",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    resetTurnUsageForTests();
    expect(turnUsageSummary()).toEqual({
      turns: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estCostMicros: 0,
      byProvider: [],
    });
  });
});
