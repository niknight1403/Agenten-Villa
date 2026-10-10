import { describe, expect, it } from "vitest";
import { evaluateTradingGate, mayAttachLiveKeys, TRADING_GATE, type TradingSimulationReport } from "./trading-gate";

const NOW = new Date("2026-10-10T06:00:00.000Z");

function report(overrides: Partial<TradingSimulationReport> = {}): TradingSimulationReport {
  return {
    winRate: 0.7,
    simulatedTrades: 600,
    profitFactor: 1.4,
    lastSimulatedAt: "2026-10-10T05:00:00.000Z",
    ...overrides,
  };
}

describe("Trading-Live-Gate (Sprint 101, Master-Prompt 2.4)", () => {
  it("definiert die harten Schwellenwerte: 68 % Win-Rate, 500 Trades, PF 1.25, 24 h", () => {
    expect(TRADING_GATE.minWinRate).toBe(0.68);
    expect(TRADING_GATE.minSimulatedTrades).toBe(500);
    expect(TRADING_GATE.minProfitFactor).toBe(1.25);
    expect(TRADING_GATE.maxWindowAgeHours).toBe(24);
  });

  it("schaltet Live-Trading bei bestandener Simulation frei", () => {
    const result = evaluateTradingGate(report(), NOW);
    expect(result.unlocked).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("sperrt bei Win-Rate unter 68 % (auch bei 67.9 %)", () => {
    const result = evaluateTradingGate(report({ winRate: 0.679 }), NOW);
    expect(result.unlocked).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("Win-Rate"))).toBe(true);
  });

  it("sperrt bei weniger als 500 simulierten Trades", () => {
    const result = evaluateTradingGate(report({ simulatedTrades: 499 }), NOW);
    expect(result.unlocked).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("Simulierte Trades 499 < 500"))).toBe(true);
  });

  it("sperrt bei instabilem Profit-Faktor", () => {
    const result = evaluateTradingGate(report({ profitFactor: 1.0 }), NOW);
    expect(result.unlocked).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("Profit-Faktor"))).toBe(true);
  });

  it("sperrt bei veraltetem Simulationsfenster (> 24 h)", () => {
    const result = evaluateTradingGate(report({ lastSimulatedAt: "2026-10-08T05:00:00.000Z" }), NOW);
    expect(result.unlocked).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("alt"))).toBe(true);
  });

  it("sperrt bei ungueltigem Simulations-Zeitpunkt", () => {
    const result = evaluateTradingGate(report({ lastSimulatedAt: "kaputt" }), NOW);
    expect(result.unlocked).toBe(false);
    expect(result.reasons).toContain("Ungueltiger Simulations-Zeitpunkt");
  });

  it("behandelt Profit-Faktor Infinity (null Verlust) als bestanden", () => {
    const result = evaluateTradingGate(report({ profitFactor: Number.POSITIVE_INFINITY }), NOW);
    expect(result.unlocked).toBe(true);
  });

  it("Live-Keys erfordern ZUSATZLICH eine separate Admin-Freigabe — nie autonom", () => {
    const unlocked = evaluateTradingGate(report(), NOW);
    expect(mayAttachLiveKeys(unlocked, false)).toBe(false);
    expect(mayAttachLiveKeys(unlocked, true)).toBe(true);
    const locked = evaluateTradingGate(report({ winRate: 0.5 }), NOW);
    expect(mayAttachLiveKeys(locked, true)).toBe(false);
  });
});
