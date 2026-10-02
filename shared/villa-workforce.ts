/**
 * Villa-Belegschaft: Jede Projekt-Villa hat automatisch eine deterministische
 * Belegschaft von 1000 logischen Agenten, aufgeteilt in feste Abteilungen.
 *
 * Ehrliche Architektur: "Logische Agenten" sind KEINE 1000 parallelen
 * Modellaufrufe. Kapazitaeten werden lazy provisioniert — der Superagent
 * orchestriert die Abteilungen als Rollen-/Zuweisungsstruktur und fuehrt die
 * konkrete Arbeit im bestehenden, bewachten Agent-Loop aus. Die Villa
 * bleibt damit kostenlos skalierbar, ohne Quoten- oder Kostenumgehung.
 */

export const WORKFORCE_SIZE = 1_000 as const;

export type WorkforceDepartment = {
  /** stabiler Bezeichner, z. B. "backend" */
  id: string;
  /** Anzeigename, z. B. "Backend-Entwicklung" */
  name: string;
  /** Forge-Rolle, die diese Abteilung wahrnimmt */
  role:
    | "PLANNER"
    | "RESEARCHER"
    | "ARCHITECT"
    | "CODER"
    | "REVIEWER"
    | "TESTER"
    | "DOCUMENTER"
    | "INTEGRATOR"
    | "BUSINESS"
    | "GROWTH";
  /** Anzahl logischer Agenten in dieser Abteilung */
  agents: number;
};

/** Aufteilung der 1000 Plaetze auf 10 Abteilungen (Summe = WORKFORCE_SIZE). */
export const WORKFORCE_DEPARTMENTS: readonly WorkforceDepartment[] = [
  { id: "koordination", name: "Koordination & Missionsleitung", role: "PLANNER", agents: 40 },
  { id: "analyse", name: "Analyse & Recherche", role: "RESEARCHER", agents: 120 },
  { id: "architektur", name: "Architektur & Design", role: "ARCHITECT", agents: 100 },
  { id: "backend", name: "Backend-Entwicklung", role: "CODER", agents: 180 },
  { id: "frontend", name: "Frontend-Entwicklung", role: "CODER", agents: 150 },
  { id: "tests", name: "Test-Engineering", role: "TESTER", agents: 120 },
  { id: "qualitaet", name: "Qualitaet & Review", role: "REVIEWER", agents: 80 },
  { id: "devops", name: "DevOps & Integration", role: "INTEGRATOR", agents: 60 },
  { id: "sicherheit", name: "Sicherheit & Compliance", role: "REVIEWER", agents: 70 },
  { id: "dokumentation", name: "Dokumentation & Handoff", role: "DOCUMENTER", agents: 80 },
] as const;

export function workforceTotal(): number {
  return WORKFORCE_DEPARTMENTS.reduce((sum, dep) => sum + dep.agents, 0);
}

/** Kompakte, deterministische Kompaktansicht fuer UI und Prompts. */
export function describeWorkforce(): string {
  return WORKFORCE_DEPARTMENTS
    .map(dep => `${dep.name} (${dep.role}, ${dep.agents} Agenten)`)
    .join("; ");
}

/**
 * Prompt-Direktive fuer den Superagenten einer Projekt-Villa:
 * Er weist die Belegschaft zu Beginn jedes Projektauftrags in die
 * Aufgabenbereiche ein und nennt die Zuweisung transparent in der
 * Antwort, bevor die Umsetzung beginnt.
 */
export function workforceDirective(villaName?: string | null): string {
  const name = villaName?.trim() || "Projekt-Villa";
  return [
    `Belegschaft der ${name}: ${WORKFORCE_SIZE} logische Agenten in ${WORKFORCE_DEPARTMENTS.length} Abteilungen — ${describeWorkforce()}.`,
    "Arbeitsweise: 1) Zerlege den Projektauftrag in Aufgabenbereiche. 2) Weise jeder Aufgabe die passende Abteilung mit Agentenzahl zu (z. B. 'Backend-Entwicklung: 60 Agenten implementieren die API'). 3) Nenne diese Einweisung kompakt am Anfang deiner Antwort. 4) Fuehre die Arbeit danach selbststaendig und strukturiert aus; beende den Auftrag nicht mit einem bloßen Plan, wenn konkrete Umsetzung moeglich ist.",
  ].join("\n");
}
