/**
 * Sprint 091 — Projektvorlagen
 *
 * Sichere Vorlagen für häufige Agentenprojekte. Jede Vorlage enthält validierte
 * Defaults, die niemals Kapazitätsgrenzen umgehen oder Limit-Bypass-Packs
 * definieren (AGENTS.md-Härtung: `agent-villa.test.ts` prüft `isKnownPack("limit-bypass") === false`).
 */
export type VillaTemplate = {
  id: string;
  name: string;
  description: string;
  /** Standard-Villa-Name beim Anlegen aus dieser Vorlage. */
  villaName: string;
  /** Spezialität/Rolle des primären Agenten. */
  specialty: string;
  /** Icon für die Villa. */
  icon: "villa" | "bot";
  /** Kapazität (1–25, Sprint 012). */
  capacity: number;
  /** Projektbeschreibung / Brief. */
  projectBrief: string;
  /** Optionale Beschreibung für die Villa. */
  villaDescription?: string;
};

/**
 * Liste der vordefinierten Projektvorlagen.
 *
 * Alle Vorlagen benutzen ausschließlich sichere, eingebaute Packs.
 * Es gibt bewusst KEINE Vorlage mit `limit-bypass` oder ähnlichem.
 */
export const VILLA_TEMPLATES: readonly VillaTemplate[] = [
  {
    id: "code-review",
    name: "Code-Review",
    description:
      "Villa für strukturierte Code-Reviews: Analyse, Verbesserungsvorschläge und Qualitätssicherung an einem Repository.",
    villaName: "Code-Review-Villa",
    specialty: "Code-Reviewer",
    icon: "villa",
    capacity: 4,
    projectBrief:
      "Analysiere ein Repository systematisch: prüfe Codequalität, identifiziere Verbesserungspotenzial, schlage konkrete Refactorings vor und dokumentiere die Ergebnisse.",
    villaDescription: "Strukturierte Code-Reviews mit klaren Empfehlungen.",
  },
  {
    id: "recherche",
    name: "Recherche",
    description:
      "Villa für Rechercheprojekte: Informationen sammeln, strukturieren und zusammenfassen.",
    villaName: "Recherche-Villa",
    specialty: "Recherche-Agent",
    icon: "bot",
    capacity: 3,
    projectBrief:
      "Recherchiere ein Thema gründlich: sammle Quellen, vergleiche Informationen, fasse die wichtigsten Erkenntnisse zusammen und erstelle einen strukturierten Bericht.",
    villaDescription: "Systematische Recherche und Wissenssammlung.",
  },
  {
    id: "brainstorming",
    name: "Brainstorming",
    description:
      "Villa für kreative Ideensuche und Konzeptentwicklung.",
    villaName: "Brainstorming-Villa",
    specialty: "Ideen-Agent",
    icon: "villa",
    capacity: 6,
    projectBrief:
      "Generiere Ideen zu einem Thema, gruppiere sie nach Themen, bewerte sie nach Machbarkeit und Impact, und entwickle die vielversprechendsten weiter.",
    villaDescription: "Kreative Ideensuche und Konzeptentwicklung.",
  },
  {
    id: "dokumentation",
    name: "Dokumentation",
    description:
      "Villa für technische Dokumentation: README, API-Doku, Benutzerhandbücher.",
    villaName: "Dokumentations-Villa",
    specialty: "Technischer Redakteur",
    icon: "villa",
    capacity: 4,
    projectBrief:
      "Erstelle technische Dokumentation für ein Projekt: README, API-Referenz, Architektur-Übersicht und Benutzerhandbuch mit klaren, nachvollziehbaren Erklärungen.",
    villaDescription: "Technische Dokumentation von Projekten.",
  },
  {
    id: "test-automatisierung",
    name: "Test-Automatisierung",
    description:
      "Villa für Test-Strategie und automatisierte Test-Abdeckung.",
    villaName: "Test-Villa",
    specialty: "Test-Engineer",
    icon: "bot",
    capacity: 5,
    projectBrief:
      "Entwickle eine Test-Strategie für ein Projekt: identifiziere kritische Pfade, schreibe Unit- und Integrationstests, richte CI-Tests ein und dokumentiere die Abdeckung.",
    villaDescription: "Test-Strategie und automatisierte Tests.",
  },
];

/** Kapazitätsgrenzen (Sprint 012: 1–25). */
export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 25;

/**
 * Validiert eine Vorlage. Wirft bei ungültigen Werten.
 * Wird beim Modul-Laden und in Tests aufgerufen.
 */
export function validateTemplate(t: VillaTemplate): void {
  if (!t.id || typeof t.id !== "string") {
    throw new Error(`Vorlage hat keine gültige ID: ${JSON.stringify(t)}`);
  }
  if (!t.name || typeof t.name !== "string") {
    throw new Error(`Vorlage ${t.id} hat keinen Namen`);
  }
  if (!t.villaName || typeof t.villaName !== "string") {
    throw new Error(`Vorlage ${t.id} hat keinen villaName`);
  }
  if (!t.specialty || typeof t.specialty !== "string") {
    throw new Error(`Vorlage ${t.id} hat keine specialty`);
  }
  if (t.icon !== "villa" && t.icon !== "bot") {
    throw new Error(`Vorlage ${t.id} hat ungültiges icon: ${t.icon}`);
  }
  if (
    !Number.isInteger(t.capacity) ||
    t.capacity < MIN_CAPACITY ||
    t.capacity > MAX_CAPACITY
  ) {
    throw new Error(
      `Vorlage ${t.id} hat ungültige capacity: ${t.capacity} (muss ${MIN_CAPACITY}–${MAX_CAPACITY} sein)`,
    );
  }
  if (!t.projectBrief || typeof t.projectBrief !== "string") {
    throw new Error(`Vorlage ${t.id} hat keinen projectBrief`);
  }
  // Sicherheitsgrenze: niemals limit-bypass oder ähnliches
  const suspicious = /limit[-_]?bypass|unlimited|quota[-_]?bypass/i;
  if (
    suspicious.test(t.id) ||
    suspicious.test(t.name) ||
    suspicious.test(t.villaName) ||
    suspicious.test(t.description) ||
    suspicious.test(t.projectBrief)
  ) {
    throw new Error(
      `Vorlage ${t.id} enthält verdächtige Begriffe (Limit-Bypass-Verdacht)`,
    );
  }
}

/** Validiere alle Vorlagen beim Laden. */
for (const t of VILLA_TEMPLATES) {
  validateTemplate(t);
}

/**
 * Findet eine Vorlage anhand ihrer ID.
 * Gibt `undefined` zurück, wenn keine Vorlage mit dieser ID existiert.
 */
export function findTemplate(id: string): VillaTemplate | undefined {
  return VILLA_TEMPLATES.find(t => t.id === id);
}

/**
 * Gibt die Eingabedaten für `createVilla` aus einer Vorlage zurück.
 * Wirft, wenn die Vorlage nicht gefunden wird.
 */
export function templateToVillaInput(templateId: string): {
  name: string;
  specialty: string;
  icon: "villa" | "bot";
  capacity: number;
  projectBrief: string;
  description: string | null;
  repository: null;
} {
  const template = findTemplate(templateId);
  if (!template) {
    throw new Error(`Unbekannte Vorlage: ${templateId}`);
  }
  return {
    name: template.villaName,
    specialty: template.specialty,
    icon: template.icon,
    capacity: template.capacity,
    projectBrief: template.projectBrief,
    description: template.villaDescription ?? null,
    repository: null,
  };
}