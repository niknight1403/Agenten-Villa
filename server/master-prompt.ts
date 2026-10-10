/**
 * Sprint 101 — Master-Prompt-Charter für das CyberSarah Control Center.
 *
 * Maschinenlesbare Definition der Mission aus docs/MASTER-PROMPT.md:
 * Die Villa arbeitet die vier Abschnitte AUSSCHLIESSLICH Abschnitt für
 * Abschnitt ab — jeder Abschnitt braucht eine separate Admin-Freigabe,
 * bevor Code für diesen Abschnitt entsteht. Ein Abschnitt gilt erst als
 * erledigt, wenn seine Verifikation (Typecheck, Tests, Build) grün ist.
 */

export const MASTER_PROMPT_VERSION = "1.0";

/** Abschnitts-Definitionen in fester, nicht überspringbarer Reihenfolge. */
export type MasterPromptSection = {
  id: string;
  label: string;
  goal: string;
};

export const MASTER_PROMPT_SECTIONS: readonly MasterPromptSection[] = [
  { id: "audit", label: "Abschnitt 1: Deep Audit & UI/UX", goal: "Quellcode-/Routing-Audit und Dashboard-Optimierung des CyberSarah Control Centers." },
  { id: "integration", label: "Abschnitt 2: Integration & Module", goal: "HAARA, SaaS-Abrechnung, Loop Engineering und Microtrading-Simulation inkl. Live-Gate." },
  { id: "influencer", label: "Abschnitt 3: KI-Influencer & Reichweite", goal: "Medien-Dossiers, Transparenz-Branding, Content-Pipelines und Monetarisierungspfade." },
  { id: "revenue", label: "Abschnitt 4: Revenue & 24/7-Master-Loop", goal: "Autonome Revenue-Discovery und laufender Executive-Master-Loop." },
] as const;

export type SectionStatus =
  | "pending" // noch nicht geplant
  | "planned" // Plan dem Admin vorgelegt, wartet auf Freigabe
  | "approved" // Freigabe erteilt, Umsetzung läuft
  | "done"; // Umsetzung verifiziert (alles grün)

export type MasterPromptProgress = {
  sections: Record<string, SectionStatus>;
  /** Letzte Admin-Freigabe (Abschnitts-Kennung), nie in die Zukunft. */
  lastApprovedSection: string | null;
};

export function initialMasterPromptProgress(): MasterPromptProgress {
  const sections: Record<string, SectionStatus> = {};
  for (const section of MASTER_PROMPT_SECTIONS) sections[section.id] = "pending";
  return { sections, lastApprovedSection: null };
}

/**
 * Freigabe-Prüfung: Code für einen Abschnitt darf nur entstehen, wenn
 * (a) der Abschnitt bekannt ist, (b) alle Vorgänger-Abschnitte "done"
 * sind und (c) genau dieser Abschnitt bereits "approved" ist.
 */
export function canExecuteSection(progress: MasterPromptProgress, sectionId: string): boolean {
  const index = MASTER_PROMPT_SECTIONS.findIndex((section) => section.id === sectionId);
  if (index < 0) return false;
  if (progress.sections[sectionId] !== "approved") return false;
  return MASTER_PROMPT_SECTIONS.slice(0, index).every(
    (predecessor) => progress.sections[predecessor.id] === "done",
  );
}

/**
 * Plan vorlegen: nur der nächste offene Abschnitt darf geplant werden.
 * Überspringen ist ausdrücklich verboten (Schritt-für-Schritt-Protokoll).
 */
export function canPlanSection(progress: MasterPromptProgress, sectionId: string): boolean {
  const index = MASTER_PROMPT_SECTIONS.findIndex((section) => section.id === sectionId);
  if (index < 0) return false;
  if (progress.sections[sectionId] !== "pending") return false;
  return MASTER_PROMPT_SECTIONS.slice(0, index).every(
    (predecessor) => progress.sections[predecessor.id] === "done",
  );
}

/** Admin-Freigabe: markiert einen geplanten Abschnitt als approved. */
export function approveSection(progress: MasterPromptProgress, sectionId: string): MasterPromptProgress {
  if (!canPlanSection(progress, sectionId) && progress.sections[sectionId] !== "planned") {
    return progress; // keine stille Freigabe ohne vorgelegten Plan
  }
  if (progress.sections[sectionId] !== "planned") return progress;
  return {
    sections: { ...progress.sections, [sectionId]: "approved" },
    lastApprovedSection: sectionId,
  };
}

/**
 * Verifikation: ein Abschnitt wird nur dann "done", wenn die Prüfung
 * tatsächlich grün war (alles erledigt: Typecheck, Tests, Build).
 */
export function completeSection(progress: MasterPromptProgress, sectionId: string, allGreen: boolean): MasterPromptProgress {
  if (!canExecuteSection(progress, sectionId)) return progress;
  if (!allGreen) return progress;
  return { sections: { ...progress.sections, [sectionId]: "done" }, lastApprovedSection: progress.lastApprovedSection };
}

/** Mission erst beendet, wenn wirklich jeder Abschnitt verifiziert grün ist. */
export function isMasterPromptComplete(progress: MasterPromptProgress): boolean {
  return MASTER_PROMPT_SECTIONS.every((section) => progress.sections[section.id] === "done");
}
