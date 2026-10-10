/**
 * Sprint 103 / Master-Prompt Abschnitt 4.2 — Executive Master-Loop (24/7).
 *
 * Kontinuierlicher Hintergrund-Zirkel:
 *   analyse → strategie-hypothese → simulation/test → deployment →
 *   einnahmen-pruefung → refactor/skalierung
 *
 * Autonom erlaubt: analyse, hypothesize, simulate, verify_revenue.
 * NUR mit Admin-Freigabe: deploy und Skalierung — die Phasenmaschine
 * stoppt strukturell bei 'needs_admin', es gibt keinen Autonom-Pfad
 * zum Deployment.
 */

export type LoopPhase =
  | "analyze"
  | "hypothesize"
  | "simulate"
  | "deploy"
  | "verify_revenue"
  | "refactor_scale";

export type LoopOutcome = "ok" | "blocked" | "needs_admin" | "error";

/** Reihenfolge des Zirkels; nach refactor_scale geht es zurueck zu analyse. */
export const LOOP_ORDER: LoopPhase[] = [
  "analyze",
  "hypothesize",
  "simulate",
  "deploy",
  "verify_revenue",
  "refactor_scale",
];

/** Naechste Phase im Zirkel (Endlosschleife gewollt). */
export function nextPhase(current: LoopPhase): LoopPhase {
  const index = LOOP_ORDER.indexOf(current);
  if (index === -1) throw new Error(`Unbekannte Loop-Phase: ${current}`);
  return LOOP_ORDER[(index + 1) % LOOP_ORDER.length];
}

/* ------------------------------------------------------------------ */
/* Phasen-Ausfuehrung (rein, testbar)                                  */
/* ------------------------------------------------------------------ */

export type PhaseContext = {
  /** Neue Signale seit letztem Lauf (z. B. aus summarizeSignals). */
  signalSummary: Record<string, number>;
  /** Hat die Trading-Sim das Live-Gate erreicht? */
  tradingSimGatePassed: boolean;
  /** Offene Hypothesen im Status 'draft' (warten auf Admin). */
  draftHypotheses: number;
  /** Aktuelle tatsaechliche Monatseinnahmen in Cent. */
  actualMonthlyCents: number;
  /** Erwartete Monatseinnahmen laut letzter Verifikation. */
  expectedMonthlyCents: number;
};

export type PhaseResult = {
  phase: LoopPhase;
  outcome: LoopOutcome;
  note: string;
  /** Naechste Phase (bei needs_admin: aktuelle Phase, bis freigegeben). */
  next: LoopPhase;
};

/**
 * Phase 'analyze': bewertet das Quellenbild. Ohne Signale → blocked
 * (ehrlich, kein Phantom-Umsatz), sonst weiter zur Hypothesen-Phase.
 */
export function runAnalyze(ctx: PhaseContext): PhaseResult {
  const signalCount = Object.keys(ctx.signalSummary).length;
  if (signalCount === 0) {
    return {
      phase: "analyze",
      outcome: "blocked",
      note: "Keine Signale im Quellenbild — wartet auf Daten aus Billing/Monetarisierung/Reach.",
      next: "analyze",
    };
  }
  return {
    phase: "analyze",
    outcome: "ok",
    note: `${signalCount} aktive Signalquellen im Quellenbild.`,
    next: "hypothesize",
  };
}

/**
 * Phase 'hypothesize': erzeugt/haelt Hypothesen. Drafts bedeuten NEEDS_ADMIN
 * — der Loop dreht hier so lange im Kreis bis der Admin freigibt.
 */
export function runHypothesize(ctx: PhaseContext): PhaseResult {
  if (ctx.draftHypotheses > 0) {
    return {
      phase: "hypothesize",
      outcome: "needs_admin",
      note: `${ctx.draftHypotheses} Hypothese(n) warten auf Admin-Freigabe.`,
      next: "hypothesize",
    };
  }
  return {
    phase: "hypothesize",
    outcome: "ok",
    note: "Keine offenen Hypothesen — Simulation von Bestandsstrategien.",
    next: "simulate",
  };
}

/**
 * Phase 'simulate': Trading-Sim-Gate pruefen. Ohne bestandenes Gate
 * → blocked (kein Live-Handel), sonst Admin-Entscheidung fuer Deploy.
 */
export function runSimulate(ctx: PhaseContext): PhaseResult {
  if (!ctx.tradingSimGatePassed) {
    return {
      phase: "simulate",
      outcome: "blocked",
      note: "Trading-Sim hat das Live-Gate (>=68 % WR, >=500 Trades, PF >=1,25) noch nicht erreicht — Simulation laeuft weiter.",
      next: "simulate",
    };
  }
  return {
    phase: "simulate",
    outcome: "needs_admin",
    note: "Simulation bestanden — Deployment erfordert Admin-Freigabe.",
    next: "simulate",
  };
}

/**
 * Phase 'deploy': DARF NUR nach Admin-Freigabe betreten werden. Der Loop
 * selbst ruft diese Phase niemals mit Autonomie auf — der Router uebernimmt
 * sie erst nach Freigabe und protokolliert sie als 'ok'.
 */
export function runDeploy(authorized: boolean): PhaseResult {
  if (!authorized) {
    return {
      phase: "deploy",
      outcome: "needs_admin",
      note: "Deployment blockiert: keine Admin-Freigabe.",
      next: "deploy",
    };
  }
  return { phase: "deploy", outcome: "ok", note: "Deployment ausgefuehrt.", next: "verify_revenue" };
}

/**
 * Phase 'verify_revenue': erwartete vs. tatsaechliche Einnahmen.
 * Unter Erwartung → Refaktor mit Minus-Notiz; ab 100 % → Skalierung
 * (Skalierungsumfang bleibt Admin-Gate). Toleranzband: 10 %.
 */
export function runVerifyRevenue(ctx: PhaseContext): PhaseResult {
  if (ctx.expectedMonthlyCents <= 0) {
    return {
      phase: "verify_revenue",
      outcome: "ok",
      note: "Keine Erwartung gesetzt — Baseline fuer naechsten Lauf: " + ctx.actualMonthlyCents + " Cent.",
      next: "refactor_scale",
    };
  }
  const ratio = ctx.actualMonthlyCents / ctx.expectedMonthlyCents;
  if (ratio < 0.9) {
    return {
      phase: "verify_revenue",
      outcome: "ok",
      note: `Einnahmen ${(Math.round(ratio * 1000) / 10)} % der Erwartung — Refaktor noetig.`,
      next: "refactor_scale",
    };
  }
  return {
    phase: "verify_revenue",
    outcome: "ok",
    note: `Einnahmenziel erreicht (${Math.round(ratio * 100)} %).`,
    next: "refactor_scale",
  };
}

/**
 * Phase 'refactor_scale': Unterziel → zurueck zu analyse mit Refaktor-Pfad;
 * Ziel erreicht → Skalierungsvorschlag, der Admin entscheidet.
 */
export function runRefactorScale(ctx: PhaseContext): PhaseResult {
  if (ctx.expectedMonthlyCents > 0 && ctx.actualMonthlyCents < ctx.expectedMonthlyCents * 0.9) {
    return {
      phase: "refactor_scale",
      outcome: "ok",
      note: "Refaktor: schwache Stufe zurueckbauen, Signale neu bewerten.",
      next: "analyze",
    };
  }
  return {
    phase: "refactor_scale",
    outcome: "needs_admin",
    note: "Skalierungsvorschlag bereit (mehr Slots/Budget) — wartet auf Admin.",
    next: "refactor_scale",
  };
}

/**
 * Fuehrt EINE Phase aus (Dispatcher). 'deploy' nur mit `authorized=true`.
 */
export function runPhase(phase: LoopPhase, ctx: PhaseContext, authorized = false): PhaseResult {
  switch (phase) {
    case "analyze": return runAnalyze(ctx);
    case "hypothesize": return runHypothesize(ctx);
    case "simulate": return runSimulate(ctx);
    case "deploy": return runDeploy(authorized);
    case "verify_revenue": return runVerifyRevenue(ctx);
    case "refactor_scale": return runRefactorScale(ctx);
    default: throw new Error(`Unbekannte Loop-Phase: ${phase}`);
  }
}

/** Tick-Intervall des Master-Loops in ms (15 Minuten, HAARA-Takt angelehnt). */
export function executiveLoopIntervalMs(): number {
  return 15 * 60 * 1000;
}
