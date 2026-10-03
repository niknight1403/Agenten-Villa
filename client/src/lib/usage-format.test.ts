import { describe, expect, it } from "vitest";
import {
  formatCostFromMicros,
  formatTokenCount,
  usageDisplay,
} from "./usage-format";

describe("Token-Budget-Anzeige (Sprint 077)", () => {
  it("formatiert Token-Zahlen mit deutscher Gruppierung", () => {
    expect(formatTokenCount(1234567)).toBe("1.234.567");
    expect(formatTokenCount(0)).toBe("0");
  });

  it("zeigt Free-Tier-Kosten ehrlich als 0,00 EUR", () => {
    expect(formatCostFromMicros(0)).toBe("0,00\u00a0€");
  });

  it("rechnet Mikro-EUR in Euro um", () => {
    expect(formatCostFromMicros(2_500_000)).toBe("2,50\u00a0€");
  });

  it("baut die Widget-Zeilen deterministisch und sortiert", () => {
    const display = usageDisplay({
      turns: 3,
      promptTokens: 900,
      completionTokens: 100,
      totalTokens: 1000,
      estCostMicros: 0,
      byProvider: [
        { provider: "openrouter", turns: 2, totalTokens: 800, estCostMicros: 0 },
        { provider: "groq", turns: 1, totalTokens: 200, estCostMicros: 0 },
      ],
    });
    expect(display.turns).toBe("3");
    expect(display.total).toBe("1.000");
    expect(display.cost).toBe("0,00\u00a0€");
    expect(display.perProvider.map(row => row.provider)).toEqual([
      "groq",
      "openrouter",
    ]);
    expect(display.perProvider[0]).toEqual({
      provider: "groq",
      turns: "1",
      tokens: "200",
      cost: "0,00\u00a0€",
    });
  });
});
