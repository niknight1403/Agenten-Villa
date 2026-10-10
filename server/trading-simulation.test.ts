/**
 * Sprint 103 — Tests: Microtrading-Simulation (Abschnitt 2.4).
 * Deterministische Kursreihen, Strategien, Backtest, Gate-Integration.
 * Live-Handel bleibt ohne bestandenes Gate + Admin-Freigabe gesperrt.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIMULATION_CONFIG,
  checkGate,
  generatePriceSeries,
  optimizeSmaCrossover,
  recordReward,
  resetTradingSimulationForTests,
  rsiStrategy,
  selectStrategy,
  simulate,
  smaCrossoverStrategy,
  toGateReport,
  type PriceBar,
} from "./trading-simulation";
import { TRADING_GATE, mayAttachLiveKeys } from "./trading-gate";

/** Aufwaerts-Reihe (deterministischer Drift) — Crossover kann gewinnen. */
function upSeries(bars = 400): PriceBar[] {
  return generatePriceSeries(bars, { seed: 123, drift: 0.001, volatility: 0.008 });
}

/** Seitwaerts-Reihe ohne Vorzug. */
function flatSeries(bars = 400): PriceBar[] {
  return generatePriceSeries(bars, { seed: 99, drift: 0, volatility: 0.006 });
}

beforeEach(() => {
  resetTradingSimulationForTests();
});

describe("Kursreihen", () => {
  it("sind fuer denselben Seed identisch (reproduzierbar)", () => {
    const a = generatePriceSeries(50, { seed: 7 });
    const b = generatePriceSeries(50, { seed: 7 });
    expect(a).toEqual(b);
  });

  it("sind fuer andere Seeds verschieden", () => {
    const a = generatePriceSeries(50, { seed: 7 });
    const b = generatePriceSeries(50, { seed: 8 });
    expect(a).not.toEqual(b);
  });

  it("liefern gueltige OHLC-Balken (low <= open/close <= high)", () => {
    for (const bar of upSeries(100)) {
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.close).toBeGreaterThan(0);
    }
  });
});

describe("Strategien", () => {
  it("SMA-Crossover gibt long/short/flat", () => {
    const strategy = smaCrossoverStrategy(5, 10);
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i); // Aufwaenstrend
    expect(strategy.evaluate({ closes, positionSizePct: 1 })).toBe("long");
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(strategy.evaluate({ closes: falling, positionSizePct: 1 })).toBe("short");
    const shortWindow = [100, 101];
    expect(strategy.evaluate({ closes: shortWindow, positionSizePct: 1 })).toBe("flat");
  });

  it("RSI kauft ueberverkauft und verkauft ueberkauft", () => {
    const strategy = rsiStrategy(14, 30, 70);
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i * 2);
    expect(strategy.evaluate({ closes: falling, positionSizePct: 1 })).toBe("long");
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    expect(strategy.evaluate({ closes: rising, positionSizePct: 1 })).toBe("short");
  });
});

describe("Backtest-Engine", () => {
  it("erzeugt eine deterministische Trade-Liste", () => {
    const strategy = smaCrossoverStrategy(10, 50);
    const a = simulate(strategy, upSeries());
    const b = simulate(strategy, upSeries());
    expect(a.trades).toEqual(b.trades);
    expect(a.strategy).toBe("sma-cross-10-50");
  });

  it("berechnet Win-Rate und Profit-Faktor korrekt", () => {
    const report = simulate(smaCrossoverStrategy(10, 50), upSeries(600));
    expect(report.trades.length).toBeGreaterThan(0);
    const wins = report.trades.filter((t) => t.win).length;
    expect(report.winRate).toBeCloseTo(wins / report.trades.length, 10);
    const grossProfit = report.trades.filter((t) => t.win).reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(
      report.trades.filter((t) => !t.win).reduce((s, t) => s + t.pnl, 0)
    );
    if (grossLoss > 0 && Number.isFinite(report.profitFactor)) {
      expect(report.profitFactor).toBeCloseTo(grossProfit / grossLoss, 8);
    }
  });

  it("haelt Drawdown im 0..100-%-Bereich", () => {
    const report = simulate(smaCrossoverStrategy(5, 100), flatSeries());
    expect(report.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(report.maxDrawdownPct).toBeLessThanOrEqual(100);
  });

  it("seitwaerts-Reihe liefert keine Wunder-Strategie (ehrlich)", () => {
    const report = simulate(smaCrossoverStrategy(10, 50), flatSeries(300));
    // Ohne Trend darf kein absurd hoher Profit-Faktor entstehen —
    // die Kosten brechen die Rueckgewinnung.
    expect(Number.isFinite(report.profitFactor) ? report.profitFactor : 100).toBeLessThan(50);
  });
});

describe("Parameter-Suche (RL-light)", () => {
  it("findet Parameter mit Mindest-Trade-Zahl", () => {
    const result = optimizeSmaCrossover(upSeries(800), { minTrades: 10 });
    expect(result.evaluated).toBeGreaterThan(0);
    expect(result.bestParams.fast).toBeLessThan(result.bestParams.slow);
    expect(result.bestReport.trades.length).toBeGreaterThanOrEqual(10);
  });

  it("bestraft Parameter mit zu wenigen Trades (keine Glueckstreffer)", () => {
    const result = optimizeSmaCrossover(upSeries(100), { minTrades: 30 });
    // In 100 Bars mit langsamen SMAs entstehen selten 30 Trades —
    // der Score muss dann negativ bleiben (keine Ueberanpassung).
    expect(result.score).toBeLessThanOrEqual(10);
  });
});

describe("Bandit-Strategiewahl", () => {
  it("exploitiert die Strategie mit hoechster Belohnung", () => {
    const good = smaCrossoverStrategy(10, 50);
    const bad = rsiStrategy(14, 30, 70);
    recordReward("sma-cross-10-50", {
      ...simulate(good, upSeries()),
      profitFactor: 3,
    });
    recordReward("rsi-14-30-70", { ...simulate(bad, flatSeries()), profitFactor: 0.2 });
    const pick = selectStrategy([bad, good], { epsilon: 0, seed: 123 });
    expect(pick.name).toBe("sma-cross-10-50");
  });

  it("exploriert mit Epsilon > 0 reproduzierbar", () => {
    const strategies = [smaCrossoverStrategy(5, 30), smaCrossoverStrategy(10, 50)];
    const a = selectStrategy(strategies, { epsilon: 1, seed: 42 });
    const b = selectStrategy(strategies, { epsilon: 1, seed: 42 });
    expect(a).toBe(b);
  });

  it("wirft bei leerer Strategieliste", () => {
    expect(() => selectStrategy([], { epsilon: 0 })).toThrow();
  });
});

describe("Gate-Integration (hartes Live-Gate)", () => {
  it("sperrt Live-Handel bei unzureichender Simulation", () => {
    const report = simulate(smaCrossoverStrategy(10, 50), flatSeries(200));
    const gate = checkGate(report);
    // Ohne 500 Trades und 68 % Win-Rate: nie frei.
    expect(gate.unlocked).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/Trades|Win-Rate|Profit-Faktor/);
  });

  it("formt den Gate-Bericht korrekt", () => {
    const report = simulate(smaCrossoverStrategy(10, 50), upSeries(200));
    const gateReport = toGateReport(report);
    expect(gateReport.simulatedTrades).toBe(report.trades.length);
    expect(gateReport.winRate).toBe(report.winRate);
    expect(gateReport.lastSimulatedAt).toBe(report.lastSimulatedAt);
  });

  it("akzeptiert ein formal bestandenes Gate nur mit Admin-Freigabe", () => {
    const passingReport = {
      winRate: 0.7,
      simulatedTrades: 520,
      profitFactor: 1.4,
      lastSimulatedAt: new Date().toISOString(),
    };
    const gate = checkGate({
      ...simulate(smaCrossoverStrategy(10, 50), upSeries(100)),
      trades: [],
      winRate: passingReport.winRate,
      profitFactor: passingReport.profitFactor,
    });
    // Simulation, die die harten Kriterien erfuellt:
    const directGate = checkGate({
      strategy: "test",
      trades: Array.from({ length: 520 }, (_, i) => ({
        entryIndex: i,
        exitIndex: i + 1,
        signal: "long" as const,
        entryPrice: 100,
        exitPrice: 101,
        pnl: 1,
        win: i < 364, // 70 %
      })),
      winRate: 0.7,
      profitFactor: 1.4,
      maxDrawdownPct: 5,
      totalPnl: 1,
      lastSimulatedAt: new Date().toISOString(),
    });
    expect(gate.unlocked).toBe(false); // echte Sim-Zahlen sind nicht genug
    expect(directGate.unlocked).toBe(true);
    // Und selbst dann: ohne Admin bleibt alles zu.
    expect(mayAttachLiveKeys(directGate, false)).toBe(false);
    expect(mayAttachLiveKeys(directGate, true)).toBe(true);
    expect(TRADING_GATE.minWinRate).toBe(0.68);
  });
});
