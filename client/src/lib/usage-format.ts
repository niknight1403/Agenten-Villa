/**
 * Sprint 077 — Anzeige-Logik fuer das Token-/Budget-Widget. Rein
 * deterministisch: Formatierung und Zeilen-Aufbau, keine Nebenwirkungen.
 */

export type TurnUsageSummaryLike = {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estCostMicros: number;
  byProvider: Array<{
    provider: string;
    turns: number;
    totalTokens: number;
    estCostMicros: number;
  }>;
};

/** Token-Zahl mit deutscher Gruppierung; Rundung bei Bruchzahlen. */
export function formatTokenCount(value: number): string {
  return Math.round(value).toLocaleString("de-DE");
}

/**
 * Mikro-EUR als Euro-Text. 0 wird ehrlich als "0,00 EUR" angezeigt —
 * die aktive Kette laeuft im Free-Tier; kein fiktiver Betrag.
 */
export function formatCostFromMicros(micros: number): string {
  const euros = micros / 1_000_000;
  return euros.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type UsageRow = {
  provider: string;
  turns: string;
  tokens: string;
  cost: string;
};

export type UsageDisplay = {
  turns: string;
  prompt: string;
  completion: string;
  total: string;
  cost: string;
  perProvider: UsageRow[];
};

/** Baut die Widget-Anzeige deterministisch aus der Server-Summary. */
export function usageDisplay(summary: TurnUsageSummaryLike): UsageDisplay {
  return {
    turns: formatTokenCount(summary.turns),
    prompt: formatTokenCount(summary.promptTokens),
    completion: formatTokenCount(summary.completionTokens),
    total: formatTokenCount(summary.totalTokens),
    cost: formatCostFromMicros(summary.estCostMicros),
    perProvider: [...summary.byProvider]
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map(entry => ({
        provider: entry.provider,
        turns: formatTokenCount(entry.turns),
        tokens: formatTokenCount(entry.totalTokens),
        cost: formatCostFromMicros(entry.estCostMicros),
      })),
  };
}
