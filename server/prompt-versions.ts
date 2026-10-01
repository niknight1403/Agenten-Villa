/**
 * Sprint 049 — Prompt- und Kontextversionierung: Änderungen am
 * Administrator-Systemprompt sind versioniert, nachvollziehbar und
 * rücksetzbar. Jede Änderung erzeugt eine Version mit Autor, Zeitstempel
 * und aktivem Inhalt; ein Rollback setzt eine frühere Version explizit
 * wieder aktiv, statt sie still zu überschreiben.
 */

export interface PromptVersion {
  version: number;
  /** null bedeutet: kein Override aktiv (Basiszustand). */
  prompt: string | null;
  changedBy: string;
  changedAt: string;
  note: string;
}

const MAX_VERSIONS = 50;

let versions: PromptVersion[] = [];

export function activePrompt(): string | null {
  return versions.length ? versions[versions.length - 1].prompt : null;
}

/** Zeichnet eine Änderung als neue Version auf und gibt sie zurück. */
export function commitPromptVersion(
  prompt: string | null,
  changedBy: string,
  note = "Systemprompt geändert."
): PromptVersion {
  const version: PromptVersion = {
    version: versions.length ? versions[versions.length - 1].version + 1 : 1,
    prompt,
    changedBy,
    changedAt: new Date().toISOString(),
    note,
  };
  versions.push(version);
  if (versions.length > MAX_VERSIONS) versions = versions.slice(-MAX_VERSIONS);
  return version;
}

export function listPromptVersions(): PromptVersion[] {
  return [...versions].reverse();
}

/**
 * Setzt eine frühere Version explizit wieder aktiv. Das Rollback selbst
 * wird als neue Version aufgezeichnet — so bleibt die Rücksetzung in der
 * Geschichte nachvollziehbar und ist selbst wieder rücksetzbar.
 */
export function rollbackPromptVersion(
  versionNumber: number,
  changedBy: string
): PromptVersion {
  const target = versions.find(entry => entry.version === versionNumber);
  if (!target)
    throw new (class UnknownPromptVersion extends Error {
      readonly code = "NOT_FOUND";
    })("Diese Prompt-Version existiert nicht.");
  return commitPromptVersion(
    target.prompt,
    changedBy,
    `Rücksetzung auf Version ${versionNumber}.`
  );
}

export function resetPromptVersionsForTests(): void {
  versions = [];
}
