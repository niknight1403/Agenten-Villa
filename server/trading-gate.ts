/**
 * Sprint 101 — Hartes Live-Trading-Gate für den Microtrading-Bot
 * (CyberSarah Control Center, Master-Prompt Abschnitt 2.4).
 *
 * Live-Trading mit echten API-Keys wird erst und nur dann freigeschaltet,
 * wenn die Simulation die Schwellenwerte NACHHALTIG überschreitet:
 *   - Mindest-Win-Rate: 68 %
 *   - Mindestanzahl simulierter Trades: 500
 *   - Profit-Faktor: stabil >= 1.25 über das gesamte Simulationsfenster
 *   - Das jüngste Simulationsfenster darf nicht älter als 24 h sein.
 *
 * Ohne bestandenes Gate ist der Live-Handel technisch gesperrt; echte
 * API-Keys werden von der Villa nie eingebunden.
 */

export const TRADING_GATE = {
  /** Mindest-Win-Rate der Simulation (0.68 = 68 %). */
  minWinRate: 0.68,
  /** Mindestanzahl simulierter Trades im Simulationsfenster. */
  minSimulatedTrades: 500,
  /** Mindest-Profit-Faktor (Brutto-Gewinn / Brutto-Verlust). */
  minProfitFactor: 1.25,
  /** Maximales Alter des jüngsten Simulationsfensters in Stunden. */
  maxWindowAgeHours: 24,
} as const;

export type TradingSimulationReport = {
  /** Anteil gewinnender Trades 0..1. */
  winRate: number;
  /** Anzahl simulierter Trades im Fenster. */
  simulatedTrades: number;
  /** Brutto-Gewinn / Brutto-Verlust (>= 0, Infinity bei null Verlust). */
  profitFactor: number;
  /** Zeitpunkt des jüngsten simulierten Trades (ISO-8601). */
  lastSimulatedAt: string;
};

export type TradingGateResult = {
  unlocked: boolean;
  reasons: string[];
};

/** Prüft, ob eine Simulation die Live-Freigabe-Kriterien erfüllt. */
export function evaluateTradingGate(
  report: TradingSimulationReport,
  now: Date = new Date(),
): TradingGateResult {
  const reasons: string[] = [];

  if (!(report.winRate >= TRADING_GATE.minWinRate)) {
    reasons.push(`Win-Rate ${(report.winRate * 100).toFixed(1)} % < ${TRADING_GATE.minWinRate * 100} %`);
  }
  if (!(report.simulatedTrades >= TRADING_GATE.minSimulatedTrades)) {
    reasons.push(`Simulierte Trades ${report.simulatedTrades} < ${TRADING_GATE.minSimulatedTrades}`);
  }
  const profitFactor = Number.isFinite(report.profitFactor) ? report.profitFactor : Number.MAX_SAFE_INTEGER;
  if (!(profitFactor >= TRADING_GATE.minProfitFactor)) {
    reasons.push(`Profit-Faktor ${report.profitFactor.toFixed(2)} < ${TRADING_GATE.minProfitFactor}`);
  }
  const lastSimulated = new Date(report.lastSimulatedAt);
  if (Number.isNaN(lastSimulated.getTime())) {
    reasons.push("Ungueltiger Simulations-Zeitpunkt");
  } else {
    const ageHours = (now.getTime() - lastSimulated.getTime()) / 3_600_000;
    if (ageHours < 0) reasons.push("Simulations-Zeitpunkt liegt in der Zukunft");
    if (ageHours > TRADING_GATE.maxWindowAgeHours) {
      reasons.push(`Simulationsfenster ist ${ageHours.toFixed(1)} h alt (> ${TRADING_GATE.maxWindowAgeHours} h)`);
    }
  }

  return { unlocked: reasons.length === 0, reasons };
}

/**
 * Live-Keys-Anbindung: selbst bei bestandenem Gate verlangt die Villa
 * eine zusaetzliche, getrennte Admin-Bestätigung (niemals autonom).
 */
export function mayAttachLiveKeys(gate: TradingGateResult, liveTradingApprovedByAdmin: boolean): boolean {
  return gate.unlocked && liveTradingApprovedByAdmin;
}
