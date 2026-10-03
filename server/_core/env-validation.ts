/**
 * Sprint 076 — strenge Produktions-Validierung der Umgebung: Fehlt eine
 * fuer den Betrieb zwingend benoetigte Variable, bricht der Start sofort
 * mit einer aussagekräftigen Fehlermeldung ab — statt spaeter im
 * Betrieb mit verwirrenden Laufzeitfehlern zu scheitern.
 *
 * Ausnahmebewusst: LLM-Anbieterschlüssel sind NICHT Pflicht — die
 * Multi-Provider-Kette (Sprints 031-038) laeuft mit jedem beliebigen
 * Teilset und meldet fehlende Keys bereits praezise zur Laufzeit
 * (MISSING_KEY). Optional bleibt optional.
 */
export type EnvValidationIssue = {
  name: string;
  purpose: string;
};

/** In Produktion zwingend notwendige Variablen mit documented purpose. */
const REQUIRED_IN_PRODUCTION: readonly EnvValidationIssue[] = [
  {
    name: "DATABASE_URL",
    purpose: "PostgreSQL — Anmeldung, Chat- und Missionspersistenz",
  },
  {
    name: "GOOGLE_CLIENT_ID",
    purpose: "Google-Anmeldung — ohne sie ist kein Login moeglich",
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    purpose: "Google-Anmeldung — ohne sie ist kein Login moeglich",
  },
];

export type EnvValidationReport = {
  ok: boolean;
  issues: EnvValidationIssue[];
  message: string;
};

function buildMessage(issues: readonly EnvValidationIssue[]): string {
  const lines = issues.map(
    issue => `  - ${issue.name} (${issue.purpose})`
  );
  return [
    "[env-validation] Start abgebrochen — Pflichtkonfiguration unvollstaendig:",
    ...lines,
    "Bitte die genannten Variablen in der Render-/Produktionsumgebung setzen und neu deployen.",
  ].join("\n");
}

/**
 * Prueft die Produktionsumgebung. Nur im Produktionsmodus ist das
 * Ergebnis blockierend; lokal/Entwicklung bleibt alles erlaubt
 * (dort ist z. B. eine fehlende Datenbank bewusst toleriert).
 */
export function validateProductionEnv(
  env: Record<string, string | undefined> = process.env,
  mode: string | undefined = process.env.NODE_ENV
): EnvValidationReport {
  if (mode !== "production") {
    return { ok: true, issues: [], message: "" };
  }
  const issues = REQUIRED_IN_PRODUCTION.filter(
    issue => !env[issue.name]?.trim()
  );
  return {
    ok: issues.length === 0,
    issues,
    message: issues.length === 0 ? "" : buildMessage(issues),
  };
}
