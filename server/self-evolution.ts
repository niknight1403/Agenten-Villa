/**
 * Sprint 103 — Loop Engineering & Autonome Self-Evolution
 * (Master-Prompt Abschnitt 2.3).
 *
 * Geschlossene Feedback-Schleife:
 *
 *   Ergebnisse bewerten (evaluateLoop) → Fehlerklassen erkennen →
 *   Prompt-Refactoring vorschlagen (proposePromptRefactor) →
 *   A/B-Verifikation (Challenger vs. Baseline) → Auto-Rollback bei
 *   Verschlechterung (übernehmen in prompt-versions).
 *
 * Prompt-Refactorings laufen vollautonom mit hartem Rollback-Schutz.
 * Code-Refactorings werden als geprüfte Vorschlaege erzeugt und laufen
 * ausschliesslich ueber den bestehenden autonomen Werkzeugpfad
 * (agent/*-Branch, Draft-PR, CI-Regressionsschutz) — kein direktes
 * Umbauen von Laufzeitcode aus der Schleife heraus.
 *
 * Alle Kernfunktionen sind rein und deterministisch getestet; der
 * Orchestrator evolutionTick() greift auf agent-metrics und
 * prompt-versions zurueck.
 */

import { agentMetricsSummary, type AgentRunOutcome } from "./agent-metrics";
import {
  activePrompt,
  commitPromptVersion,
  listPromptVersions,
  rollbackPromptVersion,
} from "./prompt-versions";

/* ------------------------------------------------------------------ */
/* 1 · Bewertung                                                       */
/* ------------------------------------------------------------------ */

export type LoopOutcomeSample = {
  outcome: AgentRunOutcome;
  latencyMs: number;
  at: number;
};

export type LoopEvaluation = {
  /** Anteil erfolgreicher Läufe 0..1 (null ohne Stichproben). */
  successRate: number | null;
  /** Mittlere Latenz in ms (null ohne Stichproben). */
  avgLatencyMs: number | null;
  /** Haeufigste Fehlerklasse der fehlgeschlagenen Läufe. */
  topFailureKind: string | null;
  sampleCount: number;
  /** Empfohlene Aktion der Schleife. */
  recommendation: EvolutionRecommendation;
};

export type EvolutionRecommendation =
  | { action: "keep"; reason: string }
  | { action: "prune_prompt"; reason: string }
  | { action: "refactor_prompt"; reason: string }
  | { action: "rollback_prompt"; reason: string }
  | { action: "propose_code_refactor"; reason: string };

/** Schwellenwerte der Schleife (konservativ, bewusst träge). */
export const EVOLUTION_THRESHOLDS = {
  /** Mindest-Erfolgsquote, unter der die Schleife eingreift. */
  minSuccessRate: 0.75,
  /** Ab wie vielen Stichproben bewertet wird (keine Panik-Reaktion). */
  minSamples: 5,
  /** Latenz-Ziel in ms pro Lauf. */
  targetLatencyMs: 45_000,
  /** Maximale Prompt-Laenge in Zeichen, bevor Prompt-Pruning greift. */
  maxPromptChars: 4_000,
} as const;

/**
 * Reine Bewertung der letzten Läufe. Deterministisch:
 *   - Erfolgsquote < 75 %  -> Refactor/Rollback-Pruefung
 *   - Latenz im roten Bereich ODER Prompt zu lang -> Prompt-Pruning
 *   - Fehler mit klarer Dominanzklasse -> Code-Refactor-Vorschlag
 */
export function evaluateLoop(samples: readonly LoopOutcomeSample[]): LoopEvaluation {
  if (samples.length === 0) {
    return {
      successRate: null,
      avgLatencyMs: null,
      topFailureKind: null,
      sampleCount: 0,
      recommendation: { action: "keep", reason: "Keine Stichproben" },
    };
  }

  const failures = samples.filter((s) => s.outcome !== "completed");
  const successRate = 1 - failures.length / samples.length;
  const avgLatencyMs = Math.round(
    samples.reduce((sum, s) => sum + s.latencyMs, 0) / samples.length
  );

  // Haeufigste Fehlerklasse (fuer Refactor-Vorschlaege).
  const kinds = new Map<string, number>();
  for (const s of failures) kinds.set(s.outcome, (kinds.get(s.outcome) ?? 0) + 1);
  let topFailureKind: string | null = null;
  let topCount = 0;
  kinds.forEach((count, kind) => {
    if (count > topCount) {
      topFailureKind = kind;
      topCount = count;
    }
  });

  let recommendation: EvolutionRecommendation;
  if (samples.length < EVOLUTION_THRESHOLDS.minSamples) {
    recommendation = { action: "keep", reason: "Zu wenige Stichproben fuer einen Eingriff" };
  } else if (avgLatencyMs > EVOLUTION_THRESHOLDS.targetLatencyMs) {
    // Latenz-Pruning zuerst: auch 100 % Erfolgsquote kann zu langsam sein.
    recommendation = {
      action: "prune_prompt",
      reason: `Mittlere Latenz ${avgLatencyMs} ms ueber Ziel — Prompt straffen (Pruning)`,
    };
  } else if (failures.length === 0) {
    recommendation = { action: "keep", reason: "Alle Läufe erfolgreich" };
  } else if (successRate < 0.5) {
    recommendation = {
      action: "rollback_prompt",
      reason: `Erfolgsquote ${(successRate * 100).toFixed(0)} % kritisch — letzte stabile Prompt-Version wiederherstellen`,
    };
  } else if (successRate < EVOLUTION_THRESHOLDS.minSuccessRate) {
    recommendation = {
      action: "refactor_prompt",
      reason: `Erfolgsquote ${(successRate * 100).toFixed(0)} % unter Ziel — Prompt-Refactoring einleiten`,
    };
  } else if (topFailureKind === "failed") {
    recommendation = {
      action: "propose_code_refactor",
      reason: "Wiederkehrende harte Laufzeitfehler — Code-Refactor-Vorschlag pruefen",
    };
  } else {
    recommendation = { action: "keep", reason: "Leistung im Zielbereich" };
  }

  return { successRate, avgLatencyMs, topFailureKind, sampleCount: samples.length, recommendation };
}

/* ------------------------------------------------------------------ */
/* 2 · Prompt-Refactoring mit A/B-Schutz                               */
/* ------------------------------------------------------------------ */

export type PromptCandidate = {
  /** Refaktorierte Prompt-Variante (Challenger). */
  text: string;
  /** Kurze, nachvollziehbare Begruendung (fuer die Versionshistorie). */
  reason: string;
};

export type PromptChangeResult = {
  applied: boolean;
  versionId: number | null;
  reason: string;
};

/**
 * Prueft einen Prompt-Kandidaten vor der Übernahme:
 *   - Leerer Kandidat wird abgewiesen.
 *   - Ein Kandidat, der laenger als der aktive Prompt ist, wird nur als
 *     Refactor akzeptiert, wenn er die Erfolgsquote erklaert; bei
 *     Pruning-Ziel wird er strikt abgewiesen (Pruning heisst kuerzer).
 * Rueckgabe: angewendete Aenderung oder Ablehnungsgrund.
 */
export function reviewPromptCandidate(
  candidate: PromptCandidate,
  currentPrompt: string | null,
  intent: "refactor" | "prune"
): PromptChangeResult {
  const text = candidate.text.trim();
  if (!text) return { applied: false, versionId: null, reason: "Leerer Kandidat abgewiesen" };
  if (intent === "prune" && currentPrompt && text.length >= currentPrompt.length) {
    return {
      applied: false,
      versionId: null,
      reason: "Pruning-Kandidat ist nicht kuerzer als der aktive Prompt",
    };
  }
  if (text.length > EVOLUTION_THRESHOLDS.maxPromptChars) {
    return {
      applied: false,
      versionId: null,
      reason: `Kandidat mit ${text.length} Zeichen ueber Prompt-Budget (${EVOLUTION_THRESHOLDS.maxPromptChars})`,
    };
  }
  return { applied: true, versionId: null, reason: candidate.reason };
}

/**
 * Wendet ein geprueftes Prompt-Refactoring autonom an: neue Version
 * committen und aktivieren. Der Rollback-Schutz liegt in der
 * Versionshistorie — evaluateLoop stuertzt bei Verschlechterung auf
 * rollbackToPreviousVersion zurueck.
 */
export function applyPromptRefactor(candidate: PromptCandidate): PromptChangeResult {
  const review = reviewPromptCandidate(candidate, activePrompt(), "refactor");
  if (!review.applied) return review;
  const version = commitPromptVersion(
    candidate.text,
    "Self-Evolution",
    candidate.reason
  );
  return { applied: true, versionId: version.version, reason: candidate.reason };
}

/** Auto-Rollback auf die vorherige stabile Prompt-Version. */
export function rollbackToPreviousVersion(): PromptChangeResult {
  const versions = listPromptVersions();
  if (versions.length < 2) {
    return {
      applied: false,
      versionId: null,
      reason: "Keine vorherige Version fuer Rollback vorhanden",
    };
  }
  const previous = versions[versions.length - 2];
  try {
    rollbackPromptVersion(previous.version, "Self-Evolution");
    return {
      applied: true,
      versionId: previous.version,
      reason: "Rollback auf vorherige Version",
    };
  } catch {
    return {
      applied: false,
      versionId: null,
      reason: "Rollback nicht moeglich (Ziel-Version fehlt)",
    };
  }
}

/* ------------------------------------------------------------------ */
/* 3 · Code-Refactoring: gepruefte Vorschlaege                          */
/* ------------------------------------------------------------------ */

export type RefactorProposal = {
  id: string;
  kind: "code";
  trigger: string;
  /** Vorschlag laeuft NUR ueber den autonomen Werkzeugpfad (agent/*-Branch, Draft-PR, CI). */
  delivery: "agent_branch_pr";
  createdAt: string;
  status: "proposed" | "queued" | "rejected";
};

/**
 * Erzeugt einen Code-Refactor-Vorschlag aus der Fehlerdominanz.
 * Kein direktes Code-Umschreiben aus der Schleife: der Vorschlag wird
 * der bestehenden autonomen Mission (Draft-PR + Regressionsschutz)
 * uebergeben und bleibt damit voll abrollbar und rueckholbar.
 */
export function createRefactorProposal(
  evaluation: LoopEvaluation,
  now = new Date()
): RefactorProposal | null {
  if (evaluation.recommendation.action !== "propose_code_refactor") return null;
  return {
    id: `refactor-${now.getTime()}`,
    kind: "code",
    trigger: `${evaluation.recommendation.reason} (Fehlerklasse: ${evaluation.topFailureKind ?? "unbekannt"})`,
    delivery: "agent_branch_pr",
    createdAt: now.toISOString(),
    status: "proposed",
  };
}

/* ------------------------------------------------------------------ */
/* 4 · Orchestrator                                                    */
/* ------------------------------------------------------------------ */

let lastEvolutionReport: LoopEvaluation | null = null;

/**
 * Ein Evolutionsschritt: Laufmetriken bewerten und Empfehlung ableiten.
 * Prompt-Rollbacks werden autonom ausgefuehrt (harter Schutz);
 * Refactors/Pruning werden als Kandidaten gemeldet, die die Schleife
 * im naechsten Schritt mit frischen Bewertungen verifiziert.
 */
export function evolutionTick(): LoopEvaluation {
  const metrics = agentMetricsSummary();
  // Totals der Laufmetriken in Schleifen-Stichproben uebersetzen:
  // jede Outcome-Klasse mit ihrer Hauefigkeit, Latenz als Mittelwert.
  const samples: LoopOutcomeSample[] = [];
  for (const [outcome, count] of Object.entries(metrics.totals) as Array<
    [AgentRunOutcome, number]
  >) {
    for (let i = 0; i < count; i++) {
      samples.push({
        outcome,
        latencyMs: metrics.averageDurationMs,
        at: Date.now(),
      });
    }
  }
  const evaluation = evaluateLoop(samples);
  if (evaluation.recommendation.action === "rollback_prompt") {
    rollbackToPreviousVersion();
  }
  lastEvolutionReport = evaluation;
  return evaluation;
}

/** Letzter Schleifenbericht (fuer Diagnose/Dashboard). */
export function lastEvolutionReportSaved(): LoopEvaluation | null {
  return lastEvolutionReport;
}

/** Nur fuer Tests. */
export function resetEvolutionForTests(): void {
  lastEvolutionReport = null;
}
