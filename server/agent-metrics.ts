/**
 * Sprint 048 — Agentenmetriken: Laufzeit, Fehler und Ergebnisstatus
 * jedes Agentenlaufs werden erfasst. In-Memory-Aggregate mit begrenzter
 * Historie — keine Nutzerinhalte, nur Zahlen und Fehlercodes.
 */

export type AgentRunOutcome =
  | "completed"
  | "partial"
  | "failed";

export type AgentRunKind = "elite" | "elite-restart";

export interface AgentRunMetric {
  kind: AgentRunKind;
  outcome: AgentRunOutcome;
  durationMs: number;
  /** TRPC- oder Fehlercode; bei Erfolg null. */
  errorCode: string | null;
  finishedAt: string;
}

const MAX_SAMPLES = 200;

let samples: AgentRunMetric[] = [];

export function recordAgentRun(metric: {
  kind: AgentRunKind;
  outcome: AgentRunOutcome;
  durationMs: number;
  errorCode?: string | null;
}): AgentRunMetric {
  const entry: AgentRunMetric = {
    kind: metric.kind,
    outcome: metric.outcome,
    durationMs: Math.max(0, Math.round(metric.durationMs)),
    errorCode: metric.errorCode ?? null,
    finishedAt: new Date().toISOString(),
  };
  samples.push(entry);
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
  return entry;
}

function toErrorLabel(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "object" && "code" in error && typeof error.code === "string")
    return error.code;
  if (typeof error === "object" && "name" in error && typeof error.name === "string")
    return error.name;
  return "UNKNOWN";
}

/** Misst einen Lauf und erfasst Laufzeit, Ergebnisstatus und Fehlercode. */
export async function instrumentAgentRun<T>(
  kind: AgentRunKind,
  isComplete: (result: T) => boolean,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    recordAgentRun({
      kind,
      outcome: isComplete(result) ? "completed" : "partial",
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    recordAgentRun({
      kind,
      outcome: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: toErrorLabel(error),
    });
    throw error;
  }
}

export interface AgentMetricsSummary {
  totals: Record<AgentRunOutcome, number>;
  errorsByCode: { code: string; count: number }[];
  /** Mittlere Laufzeit in ms über die erfassten Läufe. */
  averageDurationMs: number;
  samples: number;
}

export function agentMetricsSummary(): AgentMetricsSummary {
  const totals: Record<AgentRunOutcome, number> = { completed: 0, partial: 0, failed: 0 };
  const errors = new Map<string, number>();
  let durationTotalMs = 0;
  for (const sample of samples) {
    totals[sample.outcome] += 1;
    if (sample.errorCode) errors.set(sample.errorCode, (errors.get(sample.errorCode) ?? 0) + 1);
    durationTotalMs += sample.durationMs;
  }
  return {
    totals,
    errorsByCode: Array.from(errors.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    averageDurationMs: samples.length ? Math.round(durationTotalMs / samples.length) : 0,
    samples: samples.length,
  };
}

export function resetAgentMetricsForTests(): void {
  samples = [];
}
