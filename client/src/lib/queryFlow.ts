/**
 * Sprint 069 — Fehler- und Ladezustände (Roadmap 068).
 *
 * Akzeptanzkriterium: Kein Flow endet in einer leeren oder blockierten
 * Ansicht. Jede datengetriebene Ansicht entscheidet rein und testbar
 * über ihre Phase:
 *
 *  - „ready“: Inhalt wird gerendert (auch bei deaktivierter Abfrage —
 *    dann bewusst leer, z. B. vor der Anmeldung; kein Endlos-Spinner).
 *  - „loading“: Erstladen läuft (Skelett statt stiller Leeransicht).
 *  - „error“: Fehlerkarte mit lesbaren Text und „Erneut laden“ statt
 *    stiller Leeransicht oder blockiertem Formular.
 */

export type FlowPhase = "loading" | "error" | "ready";

export interface FlowPhaseInput {
  /** Abfrage deaktiviert (z. B. nicht angemeldet) => bewusst „ready“. */
  enabled?: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
}

export function flowPhase(input: FlowPhaseInput): FlowPhase {
  if (input.enabled === false) return "ready";
  if (input.isError) return "error";
  if (input.isPending && input.isFetching) return "loading";
  return "ready";
}

/** Lesbarer Fehlertext — niemals „undefined“ oder leer. */
export function flowErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Die Daten konnten nicht geladen werden.";
}

/**
 * Leeransicht-Schutz: Eine leere Liste im „ready“-Zustand bekommt immer
 * einen sichtbaren Hinweis statt eines stillen leeren Körpers.
 */
export function emptyFallback(phase: FlowPhase, isEmpty: boolean): string | null {
  if (phase !== "ready" || !isEmpty) return null;
  return "Keine Einträge.";
}
