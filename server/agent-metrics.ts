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
  /** Sprint 079 — Zuordnung des Laufs zu einer Villa (null: serverweit). */
  villaId: number | null;
  /** Sprint 079 — Projektlabel "owner/repo" des Ziels (null: ohne Projektbezug). */
  project: string | null;
}

/** Sprint 079 — Metrik-Scope: pro Villa und/oder Projekt filterbar. */
export interface AgentRunScope {
  villaId?: number;
  project?: string;
}

export interface AgentMetricsScopeSummary {
  scope: { villaId: number | null; project: string | null };
  totals: Record<AgentRunOutcome, number>;
  averageDurationMs: number;
  samples: number;
}

const MAX_SAMPLES = 200;

let samples: AgentRunMetric[] = [];

export function recordAgentRun(metric: {
  kind: AgentRunKind;
  outcome: AgentRunOutcome;
  durationMs: number;
  errorCode?: string | null;
  scope?: AgentRunScope;
}): AgentRunMetric {
  const entry: AgentRunMetric = {
    kind: metric.kind,
    outcome: metric.outcome,
    durationMs: Math.max(0, Math.round(metric.durationMs)),
    errorCode: metric.errorCode ?? null,
    finishedAt: new Date().toISOString(),
    villaId: metric.scope?.villaId ?? null,
    project: metric.scope?.project ?? null,
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
  run: () => Promise<T>,
  scope?: AgentRunScope,
  /**
   * Sprint 098 — Produkt-Telemetrie ist optional: Ohne Einwilligung des
   * Nutzers wird nichts erfasst (der Lauf selbst laeuft unberuehrt).
   * Der Default bleibt aus Kompatibilitaet mit bestehenden Tests aktiv.
   */
  telemetryEnabled = true
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    if (telemetryEnabled)
      recordAgentRun({
        kind,
        outcome: isComplete(result) ? "completed" : "partial",
        durationMs: Date.now() - startedAt,
        scope,
      });
    return result;
  } catch (error) {
    if (telemetryEnabled)
      recordAgentRun({
        kind,
        outcome: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: toErrorLabel(error),
      scope,
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

export function agentMetricsSummary(filter?: AgentRunScope): AgentMetricsSummary {
  const totals: Record<AgentRunOutcome, number> = { completed: 0, partial: 0, failed: 0 };
  const errors = new Map<string, number>();
  let durationTotalMs = 0;
  let count = 0;
  for (const sample of samples) {
    if (!matchesScope(sample, filter)) continue;
    totals[sample.outcome] += 1;
    if (sample.errorCode) errors.set(sample.errorCode, (errors.get(sample.errorCode) ?? 0) + 1);
    durationTotalMs += sample.durationMs;
    count += 1;
  }
  return {
    totals,
    errorsByCode: Array.from(errors.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    averageDurationMs: count ? Math.round(durationTotalMs / count) : 0,
    samples: count,
  };
}

function matchesScope(sample: AgentRunMetric, filter?: AgentRunScope): boolean {
  if (!filter) return true;
  if (filter.villaId !== undefined && sample.villaId !== filter.villaId) return false;
  if (filter.project !== undefined && sample.project !== filter.project) return false;
  return true;
}

/**
 * Sprint 079 — Scope-Übersicht für das Metrik-Dashboard: jede bekannte
 * Villa und jedes bekannte Projekt mit eigener aggregierter Kernmetrik.
 * Läufe ohne Scope erscheinen als `villaId: null` bzw. `project: null`.
 */
export function agentMetricsScopes(): AgentMetricsScopeSummary[] {
  const byKey = new Map<string, AgentRunMetric[]>();
  for (const sample of samples) {
    const key = `${sample.villaId ?? "null"}|${sample.project ?? "null"}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(sample);
    else byKey.set(key, [sample]);
  }
  return Array.from(byKey.entries())
    .map(([key, bucket]) => {
      const [villaKey, projectKey] = key.split("|");
      const totals: Record<AgentRunOutcome, number> = { completed: 0, partial: 0, failed: 0 };
      let durationTotalMs = 0;
      for (const sample of bucket) {
        totals[sample.outcome] += 1;
        durationTotalMs += sample.durationMs;
      }
      return {
        scope: {
          villaId: villaKey === "null" ? null : Number(villaKey),
          project: projectKey === "null" ? null : projectKey,
        },
        totals,
        averageDurationMs: bucket.length ? Math.round(durationTotalMs / bucket.length) : 0,
        samples: bucket.length,
      };
    })
    .sort((a, b) => b.samples - a.samples);
}

export function resetAgentMetricsForTests(): void {
  samples = [];
}
