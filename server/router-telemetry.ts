/**
 * Sprint 038 — Router-Telemetrie: Latenz, Erfolg und Fallback-Grund werden
 * aggregiert. Die Erhebung ist prozesslokal und begrenzt (die letzten
 * Turn-Samples); es werden keine Nutzdaten, Prompts oder Geheimnisse
 * gespeichert — nur Anbieter, Modell, Fehlercode und Millisekunden.
 */
import type { ProviderName } from "./provider-registry";

export type TurnTelemetrySample = {
  success: boolean;
  provider: ProviderName;
  model: string;
  attempts: number;
  latencyMs: number;
  /** Anbieter, von dem aus gewechselt wurde (null bei Direkterfolg). */
  fallbackFrom?: ProviderName;
  /** Fehlercode des gescheiterten Anbieters, der den Wechsel begruendet. */
  fallbackReason?: string;
  /** Terminaler Fehlercode, wenn der ganze Turn scheiterte. */
  errorCode?: string;
};

/** Begrenzt: maximal so viele Samples bleiben im Speicher. */
export const TELEMETRY_SAMPLE_LIMIT = 200;

const samples: TurnTelemetrySample[] = [];

export function recordRouterTelemetry(sample: TurnTelemetrySample): void {
  samples.push(sample);
  if (samples.length > TELEMETRY_SAMPLE_LIMIT)
    samples.splice(0, samples.length - TELEMETRY_SAMPLE_LIMIT);
}

export type RouterTelemetrySummary = {
  turns: number;
  successes: number;
  failures: number;
  successRate: number;
  averageLatencyMs: number;
  averageAttempts: number;
  byProvider: Array<{
    provider: ProviderName;
    turns: number;
    successes: number;
    averageLatencyMs: number;
  }>;
  fallbackReasons: Array<{ reason: string; count: number }>;
  fallbacks: number;
};

/** Aggregiert die Samples; deterministisch sortiert (alphabetisch nach Anbieter). */
export function routerTelemetrySummary(): RouterTelemetrySummary {
  const turns = samples.length;
  const successes = samples.filter(s => s.success).length;
  const latencyTotal = samples.reduce((sum, s) => sum + s.latencyMs, 0);
  const attemptTotal = samples.reduce((sum, s) => sum + s.attempts, 0);

  const providers = new Map<ProviderName, { turns: number; successes: number; latencyMs: number }>();
  for (const sample of samples) {
    const entry = providers.get(sample.provider) ?? {
      turns: 0,
      successes: 0,
      latencyMs: 0,
    };
    entry.turns += 1;
    if (sample.success) entry.successes += 1;
    entry.latencyMs += sample.latencyMs;
    providers.set(sample.provider, entry);
  }

  const reasons = new Map<string, number>();
  let fallbacks = 0;
  for (const sample of samples) {
    if (sample.fallbackFrom !== undefined) fallbacks += 1;
    if (sample.fallbackReason !== undefined)
      reasons.set(
        sample.fallbackReason,
        (reasons.get(sample.fallbackReason) ?? 0) + 1
      );
  }

  return {
    turns,
    successes,
    failures: turns - successes,
    successRate: turns === 0 ? 0 : successes / turns,
    averageLatencyMs: turns === 0 ? 0 : Math.round(latencyTotal / turns),
    averageAttempts: turns === 0 ? 0 : Math.round((attemptTotal / turns) * 10) / 10,
    byProvider: Array.from(providers.entries())
      .map(([provider, e]) => ({
        provider,
        turns: e.turns,
        successes: e.successes,
        averageLatencyMs: Math.round(e.latencyMs / e.turns),
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
    fallbacks,
    fallbackReasons: Array.from(reasons.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => a.reason.localeCompare(b.reason)),
  };
}

export function resetRouterTelemetryForTests(): void {
  samples.length = 0;
}
