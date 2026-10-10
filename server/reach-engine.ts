/**
 * Sprint 103 / Master-Prompt Abschnitt 3.2 — Reichweiten-Engine.
 *
 * Engagement-Schleife: Metriken pro Theme bewerten, performante Themen
 * gewinnen Slots. Analog zur Self-Evolution: belohnungsbasiert, mit
 * Epsilon-greedy-Bandit (Exploration bleibt moeglich, damit neue Themen
 * nicht verhungern).
 */

export type ThemeStats = {
  theme: string;
  impressions: number;
  engagements: number;
};

export type ThemeScore = {
  theme: string;
  score: number;
  /** Engagement-Rate in Prozent (0 bei 0 Impressions). */
  engagementRate: number;
};

/**
 * Engagement-Rate: Interaktionen je 100 Impressions. Bei kleinen Zahlen
 * wird Laplace-Glaettung genutzt, damit 1/1 nicht als 100 % bombt.
 */
export function engagementRate(impressions: number, engagements: number): number {
  if (impressions <= 0) return 0;
  const smoothed = (engagements + 1) / (impressions + 20);
  return Math.round((smoothed * 100) * 10) / 10;
}

/** Theme-Scores: Engagement-Rate gewichtet mit einer groben Reichweiten-Komponente. */
export function scoreThemes(stats: ThemeStats[]): ThemeScore[] {
  return stats
    .map((s) => ({
      theme: s.theme,
      engagementRate: engagementRate(s.impressions, s.engagements),
      score: Math.round(engagementRate(s.impressions, s.engagements) * 10) / 10,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Epsilon-greedy-Auswahl: mit Wahrscheinlichkeit epsilon wird ein zufaelliges
 * Theme exploriert (Seedbar fuer deterministische Tests), sonst das beste.
 * Ohne Statistiken geht es alphabetisch deterministisch weiter.
 */
export function pickTheme(
  scores: ThemeScore[],
  options: { epsilon?: number; seed?: number } = {}
): string | null {
  if (scores.length === 0) return null;
  const epsilon = options.epsilon ?? 0.15;
  const seed = options.seed ?? Date.now();
  // Deterministischer Pseudozufall (LCG) — kein Netz, keine Abhaengigkeit.
  const rand = (seed * 1664525 + 1013904223) % 4294967296 / 4294967296;
  if (rand < epsilon) {
    return scores[Math.floor(rand * scores.length) % scores.length].theme;
  }
  return scores[0].theme;
}

/** Monatsperiode 'YYYY-MM' (konsistent zu billing.currentPeriod). */
export function reachPeriod(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Fan-Affinitaets-Kennzahl: Anteil der Interaktionen an der Gesamtreichweite.
 * Ehrlich: ohne Follower-Basis ist Affinitaet nicht interpretierbar → 0.
 */
export function fanAffinity(followers: number, engagements: number): number {
  if (followers <= 0) return 0;
  return Math.round((engagements / followers) * 1000) / 10;
}
