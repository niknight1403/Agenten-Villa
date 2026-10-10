/**
 * Sprint 103 / Master-Prompt Abschnitt 4.1 — Autonome Revenue-Discovery.
 *
 * Kontinuierliche Identifikation neuer, vollautomatisierter Einnahmequellen
 * (Micro-SaaS, Content-Pipes, Automated Trading) aus INTERNEN Signalquellen:
 * Subscription/Billing (2.2), Affiliate/Sponsoring/Merch (3.2), Reach-
 * metriken und Trading-Simulation. Externe Quellen sind ein optionaler,
 * konfigurierbarer Adapter — ohne Quelle wird das ehrlich gemeldet.
 *
 * Hypothesen entstehen autonom mit Score und Begruendung, die Ueberfuehrung
 * in die Umsetzung (deployed/scaled) ist NUR mit Admin-Freigabe moeglich.
 */

import type { RevenueSignal } from "../drizzle/schema";

/** Interne Signalquellen (keine bezahlten APIs). */
export type SignalSource =
  | "billing"
  | "affiliate"
  | "sponsorship"
  | "merch"
  | "reach"
  | "trading";

export type SignalInput = {
  source: SignalSource;
  key: string;
  value: number;
  period: string;
};

/** Externer Adapter: ohne Konfiguration liefert er nichts — ehrlich. */
export type TrendAdapter = {
  name: string;
  fetchTrends(): Promise<{ topic: string; demand: number }[]>;
};

/** Periode 'YYYY-MM' (konsistent zu billing/reach-engine). */
export function discoveryPeriod(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Signale validieren: Quelle bekannt, Wert ganzzahlig >= 0, Periode korrekt. */
export function validSignal(input: SignalInput): boolean {
  const sources: SignalSource[] = ["billing", "affiliate", "sponsorship", "merch", "reach", "trading"];
  return (
    sources.includes(input.source) &&
    typeof input.key === "string" &&
    input.key.length > 0 &&
    input.key.length <= 64 &&
    Number.isInteger(input.value) &&
    input.value >= 0 &&
    /^\d{4}-\d{2}$/.test(input.period)
  );
}

/** Fasst Signale einer Quelle zu einem kompakten Quellenbild zusammen. */
export function summarizeSignals(signals: RevenueSignal[]): Record<string, number> {
  return signals.reduce<Record<string, number>>((acc, s) => {
    const compositeKey = `${s.source}:${s.key}`;
    acc[compositeKey] = (acc[compositeKey] ?? 0) + s.value;
    return acc;
  }, {});
}

/* ------------------------------------------------------------------ */
/* Hypothesen-Scoring                                                  */
/* ------------------------------------------------------------------ */

export type HypothesisKind = "micro_saas" | "content_pipe" | "automated_trading";

export type HypothesisDraft = {
  kind: HypothesisKind;
  title: string;
  rationale: string;
  score: number;
  expectedMonthlyCents: number;
};

export type ScoreInput = {
  /** Markt-/Nachfragegroesse 0-100. */
  market: number;
  /** Automatisierbarkeit 0-100. */
  automatability: number;
  /** Kostenrisiko 0-100 (hoeher = teurer im Betrieb). */
  cost: number;
  /** Umsetzungsrisiko 0-100 (hoeher = riskanter). */
  risk: number;
};

/**
 * Gesamtscore: Markt und Automatisierbarkeit wirken positiv, Kosten und
 * Risiko negativ. Alles wird auf 0-100 geklemmt, Determinismus pur.
 */
export function hypothesisScore(input: ScoreInput): number {
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const raw = input.market * 0.35 + input.automatability * 0.35 - input.cost * 0.15 - input.risk * 0.15;
  return clamp(raw);
}

/** Mindest-Score, ab dem eine Hypothese als Entwurf angelegt wird. */
export const HYPOTHESIS_SCORE_THRESHOLD = 40;

/**
 * Heuristische Hypothesen-Erzeugung aus dem Quellenbild — deterministisch
 * und ohne LLM: hohe Affiliate-Klicks → Content-Pipe; stabile Token-Nachfrage
 * → Micro-SaaS; Trading-Sim ueber Gate → Automated Trading.
 * (LLM-Verfeinerung macht die Agent-Engine, Budget aus Abschnitt 2.)
 */
export function deriveHypotheses(
  summary: Record<string, number>,
  options: { tradingSimGatePassed?: boolean; scoreThreshold?: number } = {}
): HypothesisDraft[] {
  const threshold = options.scoreThreshold ?? HYPOTHESIS_SCORE_THRESHOLD;
  const drafts: HypothesisDraft[] = [];

  const affiliateClicks = Object.entries(summary)
    .filter(([k]) => k.startsWith("affiliate:"))
    .reduce((sum, [, v]) => sum + v, 0);
  if (affiliateClicks >= 50) {
    const score = hypothesisScore({ market: 70, automatability: 90, cost: 20, risk: 25 });
    if (score >= threshold) {
      drafts.push({
        kind: "content_pipe",
        title: "Content-Pipe skalieren: Affiliate-getriebene Serie",
        rationale: `${affiliateClicks} Affiliate-Klicks im Quellenbild — Nachfrage vorhanden, Produktion voll automatisierbar (Scheduler aus 3.2).`,
        score,
        expectedMonthlyCents: affiliateClicks * 150,
      });
    }
  }

  const tokenDemand = summary["billing:tokens"] ?? 0;
  if (tokenDemand >= 100_000) {
    const score = hypothesisScore({ market: 65, automatability: 80, cost: 30, risk: 30 });
    if (score >= threshold) {
      drafts.push({
        kind: "micro_saas",
        title: "Micro-SaaS: Agenten-Nutzung als Service-Package",
        rationale: `${tokenDemand} Tokens Nachfrage im Zeitraum — Power-User existieren, Abwicklung laeuft durch Billing (2.2).`,
        score,
        expectedMonthlyCents: 19_00 * 5,
      });
    }
  }

  const simTrades = summary["trading:sim_trades"] ?? 0;
  if (options.tradingSimGatePassed === true && simTrades >= 500) {
    const score = hypothesisScore({ market: 65, automatability: 85, cost: 25, risk: 50 });
    if (score >= threshold) {
      drafts.push({
        kind: "automated_trading",
        title: "Automated Trading: simulierte Strategie zur Live-Freigabe vorbereiten",
        rationale: `Trading-Sim hat das Live-Gate (>=68 % Win-Rate, >=500 Trades, PF >=1,25) erreicht — Live-Handel bleibt hinter Admin-Freigabe.`,
        score,
        expectedMonthlyCents: 50_00,
      });
    }
  }

  return drafts;
}

/* ------------------------------------------------------------------ */
/* Hypothesen-Statusmaschine: Deploy nur nach Admin-Freigabe          */
/* ------------------------------------------------------------------ */

export type HypothesisStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "deployed"
  | "scaled"
  | "parked";

/**
 * Statusuebergaenge: draft → approved/rejected NUR durch Admin-Event,
 * approved → deployed/scaled NUR durch Admin-Event. Es gibt keinen
 * Autonom-Pfad aus 'draft' heraus in die Umsetzung.
 */
export function nextHypothesisStatus(
  current: HypothesisStatus,
  event: "approve" | "reject" | "deploy" | "scale" | "park"
): HypothesisStatus {
  if (event === "approve" && current === "draft") return "approved";
  if (event === "reject" && current === "draft") return "rejected";
  if (event === "deploy" && current === "approved") return "deployed";
  if (event === "scale" && current === "deployed") return "scaled";
  if (event === "park" && (current === "approved" || current === "deployed")) return "parked";
  throw new Error(`Ungueltiger Hypothesen-Uebergang: ${current} + ${event}`);
}
