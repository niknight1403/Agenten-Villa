/**
 * Sprint 077 — Token-Nutzung je Anfrage: Provider-Antworten liefern ein
 * usage-Objekt (prompt/completion/total). Dieses Modul erfasst die Nutzlast
 * prozesslokal und begrenzt (die letzten Turn-Samples), ohne Prompts,
 * Antworten oder Geheimnisse — nur Anzahlen und Schaetzwerte.
 *
 * Kostenmodell: alle Anbieter der Free-Tier-Kette kosten 0 EUR. Die
 * Preis-Tabelle ist bewusst offen fuer bezahlte Modelle; solange ein
 * Eintrag 0 ist, wird ehrlich 0 angezeigt statt fiktiver Beträge.
 */
import type { ProviderName } from "./provider-registry";

export type TurnUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TurnUsageSample = {
  provider: ProviderName;
  model: string;
  usage: TurnUsage;
  at: string;
};

export type TurnUsageSummary = {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estCostMicros: number;
  byProvider: Array<{
    provider: ProviderName;
    turns: number;
    totalTokens: number;
    estCostMicros: number;
  }>;
};

/** Begrenzt: maximal so viele Samples bleiben im Speicher. */
export const TURN_USAGE_SAMPLE_LIMIT = 200;

/** Mikro-EUR je 1.000 Tokens; Free-Tier- und lokale Anbieter sind bewusst 0. */
const EST_COST_MICROS_PER_1K_TOKENS: Record<ProviderName, number> = {
  ollama: 0, // Sprint 080 — eigene Hardware: kein Token-Preis
  openrouter: 0,
  groq: 0,
  gemini: 0,
  huggingface: 0,
};

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  return Math.round(value);
}

/**
 * Extrahiert das usage-Objekt einer OpenAI-kompatiblen Completion-Antwort.
 * Fehlt es oder ist es unlesbar, ist das Ergebnis null — keine Schaetzung,
 * keine Erfindung.
 */
export function extractTurnUsage(payload: unknown): TurnUsage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const raw = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  const promptTokens = nonNegativeInteger(raw.prompt_tokens);
  const completionTokens = nonNegativeInteger(raw.completion_tokens);
  const totalTokens = nonNegativeInteger(raw.total_tokens);
  if (promptTokens === null && completionTokens === null && totalTokens === null)
    return null;
  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    // total wird bevorzugt aus der Antwort gelesen; fehlt er, ist die
    // Summe die einzige ehrliche Aussage.
    totalTokens: totalTokens ?? prompt + completion,
  };
}

function costMicros(provider: ProviderName, tokens: number): number {
  const rate = EST_COST_MICROS_PER_1K_TOKENS[provider] ?? 0;
  return Math.round((tokens / 1000) * rate);
}

let samples: TurnUsageSample[] = [];

/** Erfasst einen erfolgreichen Turn; die Historie bleibt begrenzt. */
export function recordTurnUsage(input: {
  provider: ProviderName;
  model: string;
  usage: TurnUsage;
}): TurnUsageSample {
  const entry: TurnUsageSample = {
    provider: input.provider,
    model: input.model.slice(0, 120),
    usage: {
      promptTokens: Math.max(0, Math.round(input.usage.promptTokens)),
      completionTokens: Math.max(0, Math.round(input.usage.completionTokens)),
      totalTokens: Math.max(0, Math.round(input.usage.totalTokens)),
    },
    at: new Date().toISOString(),
  };
  samples.push(entry);
  if (samples.length > TURN_USAGE_SAMPLE_LIMIT)
    samples.splice(0, samples.length - TURN_USAGE_SAMPLE_LIMIT);
  return entry;
}

/** Aggregiert die Samples; Anbieter alphabetisch sortiert (deterministisch). */
export function turnUsageSummary(): TurnUsageSummary {
  const providers = new Map<
    ProviderName,
    { turns: number; totalTokens: number; estCostMicros: number }
  >();
  let promptTokens = 0;
  let completionTokens = 0;
  for (const sample of samples) {
    promptTokens += sample.usage.promptTokens;
    completionTokens += sample.usage.completionTokens;
    const entry = providers.get(sample.provider) ?? {
      turns: 0,
      totalTokens: 0,
      estCostMicros: 0,
    };
    entry.turns += 1;
    entry.totalTokens += sample.usage.totalTokens;
    entry.estCostMicros += costMicros(sample.provider, sample.usage.totalTokens);
    providers.set(sample.provider, entry);
  }
  const totalTokens = promptTokens + completionTokens;
  return {
    turns: samples.length,
    promptTokens,
    completionTokens,
    totalTokens,
    estCostMicros: Array.from(providers.values()).reduce(
      (sum, entry) => sum + entry.estCostMicros,
      0
    ),
    byProvider: Array.from(providers.entries())
      .map(([provider, entry]) => ({ provider, ...entry }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
  };
}

/** Nur fuer Tests: Samples zuruecksetzen. */
export function resetTurnUsageForTests(): void {
  samples = [];
}
