/**
 * Sprint 103 — Microtrading: Backtesting- & Paper-Trading-Simulation
 * (Master-Prompt Abschnitt 2.4).
 *
 * Isolierte Hochgeschwindigkeits-Simulation (kein Netz, kein echter
 * Handel, keine echten Keys):
 *   - Deterministische Kursreihen (geseedeter PRNG, reproduzierbar)
 *   - Strategie-Framework mit Signalen (Long/Short/Flat)
 *   - Backtest-Engine mit realistischem Kostenmodell (Spread + Gebuehr)
 *   - Metriken: Win-Rate, Profit-Faktor, Max-Drawdown
 *   - Parameter-Suche (Reinforcement-light: Belohnungs-basierte
 *     Auswahl, Epsilon-greedy Bandit ueber Strategien)
 *
 * Der resultierende Bericht speist DIREKT das harte Live-Gate
 * (trading-gate.ts): 68 % Win-Rate ueber >= 500 Trades, Profit-Faktor
 * >= 1.25, Fenster <= 24 h — plus getrennte Admin-Freigabe fuer echte
 * Keys. Ohne bestandenes Gate bleibt der Live-Handel technisch
 * gesperrt.
 */

import {
  evaluateTradingGate,
  TRADING_GATE,
  type TradingGateResult,
  type TradingSimulationReport,
} from "./trading-gate";

/* ------------------------------------------------------------------ */
/* 1 · Deterministische Kursreihe (geseedeter PRNG)                    */
/* ------------------------------------------------------------------ */

/** Mulberry32 — kleiner, deterministcher PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type PriceBar = { open: number; high: number; low: number; close: number };

/**
 * Synthetische Kursreihe: Random Walk mit Drift (Trend) und Volatilität.
 * Deterministisch fuer einen gegebenen Seed — Backtests sind damit
 * voll reproduzierbar und vergleichbar.
 */
export function generatePriceSeries(
  bars: number,
  options: { seed?: number; startPrice?: number; drift?: number; volatility?: number } = {}
): PriceBar[] {
  const rand = mulberry32(options.seed ?? 42);
  const start = options.startPrice ?? 100;
  const drift = options.drift ?? 0.0002;
  const volatility = options.volatility ?? 0.01;
  const series: PriceBar[] = [];
  let price = start;
  for (let i = 0; i < bars; i++) {
    const shock = (rand() - 0.5) * 2 * volatility;
    const open = price;
    const close = Math.max(0.01, open * (1 + drift + shock));
    const high = Math.max(open, close) * (1 + rand() * volatility * 0.5);
    const low = Math.min(open, close) * (1 - rand() * volatility * 0.5);
    series.push({ open, high, low, close });
    price = close;
  }
  return series;
}

/* ------------------------------------------------------------------ */
/* 2 · Strategie-Framework                                            */
/* ------------------------------------------------------------------ */

export type TradeSignal = "long" | "short" | "flat";

export type StrategyContext = {
  /** Historische Schlusskurse, aelteste zuerst. */
  closes: number[];
  /** Positionslimit in Prozent des Kapitals je Trade. */
  positionSizePct: number;
};

export type TradingStrategy = {
  name: string;
  /** Kurze, nachvollziehbare Beschreibung (Dokumentation). */
  description: string;
  /** Erzeugt ein Signal aus dem Kursfenster. */
  evaluate: (context: StrategyContext) => TradeSignal;
};

/** Einfacher gleitender Durchschnitt. */
function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/** SMA-Crossover: schnellem Durchschnitt ueber langsamem = long. */
export function smaCrossoverStrategy(fast: number, slow: number): TradingStrategy {
  return {
    name: `sma-cross-${fast}-${slow}`,
    description: `SMA-Crossover: ${fast}er ueber ${slow}er Durchschnitt`,
    evaluate: ({ closes }) => {
      const fastSma = sma(closes, fast);
      const slowSma = sma(closes, slow);
      if (fastSma === null || slowSma === null) return "flat";
      if (fastSma > slowSma) return "long";
      if (fastSma < slowSma) return "short";
      return "flat";
    },
  };
}

/** RSI-Mean-Reversion: ueberverkauft kaufen, ueberkauft verkaufen. */
export function rsiStrategy(period: number, oversold: number, overbought: number): TradingStrategy {
  return {
    name: `rsi-${period}-${oversold}-${overbought}`,
    description: `RSI-Mean-Reversion: Kauf < ${oversold}, Verkauf > ${overbought}`,
    evaluate: ({ closes }) => {
      if (closes.length < period + 1) return "flat";
      let gains = 0;
      let losses = 0;
      for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
      }
      // RSI-Semantik: nur Gewinne -> RSI 100 (ueberkauft), nur
      // Verluste -> RSI 0 (ueberverkauft).
      const rsi =
        losses === 0 ? (gains > 0 ? 100 : 50) : 100 - 100 / (1 + gains / losses);
      if (rsi > overbought) return "short";
      if (rsi < oversold) return "long";
      return "flat";
    },
  };
}

/* ------------------------------------------------------------------ */
/* 3 · Backtesting-Engine                                              */
/* ------------------------------------------------------------------ */

export type SimulatedTrade = {
  /** Einstiegsbar-Index. */
  entryIndex: number;
  /** Austrittsbar-Index. */
  exitIndex: number;
  signal: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  /** Brutto-P/L in Preis-Einheiten. */
  pnl: number;
  /** true, wenn der Trade Gewinn machte. */
  win: boolean;
};

export type SimulationConfig = {
  /** Blickfenster (Bars) fuer das Strategie-Signal. */
  windowSize: number;
  /** Positionsgroesse je Trade (Anteil 0..1 des Kapitals). */
  positionSize: number;
  /** Kosten in Preis-Einheiten pro Trade (Spread + Gebuehr). */
  costsPerTrade: number;
};

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  windowSize: 200,
  positionSize: 1,
  costsPerTrade: 0.05,
};

export type SimulationReport = {
  strategy: string;
  trades: SimulatedTrade[];
  /** Anteil gewinnender Trades 0..1. */
  winRate: number;
  /** Brutto-Gewinn / Brutto-Verlust. */
  profitFactor: number;
  /** Groesster prozentualer Kapitalrueckgang vom Hoechststand. */
  maxDrawdownPct: number;
  totalPnl: number;
  lastSimulatedAt: string;
};

/**
 * Backtest: faehrt die Strategie ueber die Kursreihe und schliesst
 * jede Position beim Signalwechsel (Flat oder Gegenrichtung).
 * Bewusst simpel und deterministisch — Paper-Trading, kein Netz.
 */
export function simulate(
  strategy: TradingStrategy,
  series: PriceBar[],
  config: SimulationConfig = DEFAULT_SIMULATION_CONFIG,
  now = new Date()
): SimulationReport {
  const trades: SimulatedTrade[] = [];
  let openTrade: { signal: "long" | "short"; entryIndex: number; entryPrice: number } | null = null;
  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;

  for (let i = 0; i < series.length; i++) {
    const bar = series[i];
    const window = series.slice(Math.max(0, i - config.windowSize + 1), i + 1);
    const signal = strategy.evaluate({
      closes: window.map((b) => b.close),
      positionSizePct: config.positionSize,
    });

    // Offene Position bei Signalwechsel oder Reihenende schliessen.
    if (openTrade) {
      const shouldClose =
        signal === "flat" ||
        (signal === "long" && openTrade.signal === "short") ||
        (signal === "short" && openTrade.signal === "long") ||
        i === series.length - 1;
      if (shouldClose) {
        const exitPrice = bar.close;
        const gross =
          openTrade.signal === "long"
            ? (exitPrice - openTrade.entryPrice) * config.positionSize
            : (openTrade.entryPrice - exitPrice) * config.positionSize;
        const pnl = gross - config.costsPerTrade;
        trades.push({
          entryIndex: openTrade.entryIndex,
          exitIndex: i,
          signal: openTrade.signal,
          entryPrice: openTrade.entryPrice,
          exitPrice,
          pnl,
          win: pnl > 0,
        });
        equity += pnl / 100; // normierte Equity-Entwicklung
        peak = Math.max(peak, equity);
        maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak);
        openTrade = null;
      }
    }

    if (!openTrade && signal !== "flat" && i < series.length - 1) {
      openTrade = { signal, entryIndex: i, entryPrice: bar.close };
    }
  }

  const wins = trades.filter((t) => t.win);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => !t.win).reduce((sum, t) => sum + t.pnl, 0));
  return {
    strategy: strategy.name,
    trades,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss,
    maxDrawdownPct: maxDrawdownPct * 100,
    totalPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
    lastSimulatedAt: now.toISOString(),
  };
}

/** Gate-Bericht aus dem Simulationsbericht formen (direkte Gate-Speisung). */
export function toGateReport(report: SimulationReport): TradingSimulationReport {
  return {
    winRate: report.winRate,
    simulatedTrades: report.trades.length,
    profitFactor: report.profitFactor,
    lastSimulatedAt: report.lastSimulatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* 4 · Parameter-Suche (Reinforcement-light)                           */
/* ------------------------------------------------------------------ */

export type OptimizationResult = {
  bestParams: { fast: number; slow: number };
  bestReport: SimulationReport;
  /** Bewertung: Profit-Faktor mit Mindest-Trade-Anteil. */
  score: number;
  evaluated: number;
};

/**
 * Belohnungs-basierte Parametersuche ueber eine Crossover-Grid:
 * Score = Profit-Faktor, aber nur wenn genuegend Trades entstanden
 * sind (keine Gluecks-Einzeltrades). Bewusst kleine, schnelle Grids —
 * Hochgeschwindigkeits-Simulation ohne Ueberanpassung.
 */
export function optimizeSmaCrossover(
  series: PriceBar[],
  options: { minTrades?: number; config?: SimulationConfig; now?: Date } = {}
): OptimizationResult {
  const minTrades = options.minTrades ?? 30;
  let best: OptimizationResult | null = null;
  let evaluated = 0;
  for (const fast of [5, 10, 15]) {
    for (const slow of [30, 50, 100]) {
      if (fast >= slow) continue;
      const strategy = smaCrossoverStrategy(fast, slow);
      const report = simulate(strategy, series, options.config, options.now);
      evaluated++;
      const score =
        report.trades.length >= minTrades && Number.isFinite(report.profitFactor)
          ? report.profitFactor
          : report.trades.length >= minTrades
            ? 10 // Infinity-Score: sehr gut, aber nicht unendlich bewerten
            : -1;
      if (best === null || score > best.score) {
        best = { bestParams: { fast, slow }, bestReport: report, score, evaluated };
      }
    }
  }
  return best!;
}

/* ------------------------------------------------------------------ */
/* 5 · Epsilon-greedy Bandit ueber Strategien                          */
/* ------------------------------------------------------------------ */

const banditRewards = new Map<string, { reward: number; pulls: number }>();

/**
 * Epsilon-greedy Auswahl: mit Wahrscheinlichkeit epsilon wird exploriert,
 * sonst die Strategie mit der hoechsten bekannten Belohnung exploitiert.
 * Deterministisch fuer einen Seed (Tests reproducierbar).
 */
export function selectStrategy(
  strategies: TradingStrategy[],
  options: { epsilon?: number; seed?: number } = {}
): TradingStrategy {
  if (strategies.length === 0) throw new Error("Keine Strategien zur Auswahl");
  if (strategies.length === 1) return strategies[0];
  const rand = mulberry32(options.seed ?? 7);
  const epsilon = options.epsilon ?? 0.1;
  if (rand() < epsilon) {
    return strategies[Math.floor(rand() * strategies.length) % strategies.length];
  }
  let best = strategies[0];
  let bestReward = -Infinity;
  for (const strategy of strategies) {
    const entry = banditRewards.get(strategy.name);
    const reward = entry ? entry.reward / Math.max(1, entry.pulls) : 0;
    if (reward > bestReward) {
      bestReward = reward;
      best = strategy;
    }
  }
  return best;
}

/** Belohnung nach einem Simulationslauf zurueckmelden (RL-Update). */
export function recordReward(strategyName: string, report: SimulationReport): void {
  const reward = Number.isFinite(report.profitFactor) ? report.profitFactor : 10;
  const entry = banditRewards.get(strategyName) ?? { reward: 0, pulls: 0 };
  banditRewards.set(strategyName, { reward: entry.reward + reward, pulls: entry.pulls + 1 });
}

/** Nur fuer Tests: Bandit-Zustand zuruecksetzen. */
export function resetTradingSimulationForTests(): void {
  banditRewards.clear();
}

/* ------------------------------------------------------------------ */
/* 6 · Gate-Integration                                                */
/* ------------------------------------------------------------------ */

/** Prueft einen Simulationsbericht gegen das harte Live-Gate. */
export function checkGate(report: SimulationReport, now = new Date()): TradingGateResult {
  return evaluateTradingGate(toGateReport(report), now);
}

/** Zentrale Gate-Konstanten fuer Diagnose-Ausgaben. */
export { TRADING_GATE };
