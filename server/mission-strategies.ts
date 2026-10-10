/**
 * Sprint 095 — Erweiterungspunkte: die Missions-Strategien (Phasen der
 * Fertigstell-Empfehlung) liegen in EINEM Register. Neue Phasen sind ein
 * neuer Registereintrag — ohne Kernumbau in agent-router oder Prompts.
 *
 * Invarianten:
 *  - Jede Strategie hat eine nummerierte Kurzbeschreibung fuer den
 *    Analyse-Prompt und ein Festformat fuer die Empfehlungszeile.
 *  - Das tRPC-Schema wird aus dem Register abgeleitet (nie inline im
 *    Router dupliziert).
 *  - Der Empfehlungs-Parser akzeptiert nur registrierte Strategien.
 */
import { z } from "zod";

export type MissionStrategyId = "OPTIMIZE" | "REBUILD";

/** Das Register: neue Phasen NUR HIER ergänzen. */
export const MISSION_STRATEGIES: ReadonlyArray<{
  id: MissionStrategyId;
  /** Kurzform im Analyse-Prompt (ohne Nummerierung). */
  label: string;
  /** Was die Strategie fuer den Nutzer bedeutet. */
  choice: string;
}> = [
  {
    id: "OPTIMIZE",
    label: "OPTIMIZE",
    choice:
      "das bestehende Projekt weiterentwickeln, verbessern und optimieren.",
  },
  {
    id: "REBUILD",
    label: "REBUILD",
    choice:
      "einen begruendeten Neubau als neues Projekt planen.",
  },
];

export const MISSION_STRATEGY_IDS = [
  ...MISSION_STRATEGIES.map((strategy) => strategy.id),
] as [MissionStrategyId, ...MissionStrategyId[]];

/** tRPC-Eingabeschema — aus dem Register abgeleitet. */
export const missionStrategySchema = z.enum(MISSION_STRATEGY_IDS);

export type MissionStrategy = z.infer<typeof missionStrategySchema>;

/** Vollstaendige Wahlmoeglichkeiten als Prompt-Baustein (Sprint 071-Format). */
export function strategyChoicePrompt(): string[] {
  const lines = [
    "Lege dem Nutzer danach genau zwei Fertigstell-Moeglichkeiten vor, jede mit kurzer Begruendung und Konsequenz:",
  ];
  MISSION_STRATEGIES.forEach((strategy, index) => {
    lines.push(`${index + 1}) ${strategy.label} — ${strategy.choice}`);
  });
  lines.push(
    "Empfehlungspflicht: Nenne die aus deiner Analyse besser geeignete Option als klare Empfehlung.",
    `Beende die Antwort zwingend mit einer eigenen Zeile im Format ${MISSION_STRATEGIES.map(
      (strategy) => `'EMPFEHLUNG: ${strategy.id}'`
    ).join(" oder ")}.`
  );
  return lines;
}

/** Liest 'EMPFEHLUNG: <STRATEGIE>' aus einer Antwort; nur registrierte zaehlen. */
export function parseStrategyRecommendation(answer: string): MissionStrategyId | null {
  const match = /EMPFEHLUNG:\s*([A-Z]+)/.exec(answer);
  if (!match) return null;
  return MISSION_STRATEGY_IDS.includes(match[1] as MissionStrategyId)
    ? (match[1] as MissionStrategyId)
    : null;
}
