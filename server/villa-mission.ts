/**
 * Sprint 072 — Autonome Villa-Mission im Chat-Entwicklungsfenster.
 *
 * Pure Bausteine (ohne tRPC/Datenbank), damit der Missionsauftrag,
 * der Stopp-Bericht und die Empfehlungslogik getestet bleiben:
 *
 *  - buildVillaMissionObjective: leitet aus dem Projektziel der Villa
 *    und einem optionalen Nutzer-Auftrag den Missionsauftrag ab:
 *    zuerst Analyse, dann Umsatz-/Autonomie-Verbesserung und
 *    Stabilisierung, abschließend Empfehlungen (verbessern oder neues
 *    Projekt) und ein sauberer Bericht.
 *  - buildStoppedMissionReport: ehrlicher Abschluss-Bericht nach dem
 *    Stopp-Knopf — was passiert ist, was noch offen bleibt.
 */

export type VillaMissionContext = {
  villaName: string;
  projectBrief?: string | null;
  repository?: string | null;
};

/** Direktive für jede autonome Villa-Mission (Analyse zuerst). */
export const VILLA_MISSION_DIRECTIVE = [
  "1. Analysiere zuerst das verbundene Repository vollständig: Struktur, README/Setup, Tests, CI, Dokumentation und aktueller Zustand.",
  "2. Verbessere und stabilisiere danach alles Umsatz- und Autonomie-orientiert: Monetarisierung, Automatisierung, Zuverlässigkeit, Fehlerbehandlung und Performance.",
  "3. Arbeite autonom weiter, bis der Auftrag abgeschlossen ist (maximal 24 GitHub-Aktionen, 12 Werkzeugrunden).",
  "4. Gib am Ende klare Empfehlungen: was als Nächstes verbessert werden muss, und ob das bestehende Projekt weiterentwickelt oder ein neues Projekt entwickelt werden sollte.",
  "5. Schließe mit einem sauberen, verständlichen Bericht ab: was erledigt wurde, was offen blieb, wie der Stand geprüft werden kann.",
].join("\n");

/** Missionsauftrag aus Villa-Kontext + optionalem Nutzer-Auftrag. */
export function buildVillaMissionObjective(
  villa: VillaMissionContext,
  customObjective?: string | null
): string {
  const custom = customObjective?.trim();
  const repository = villa.repository?.trim()
    ? `\nVerbundenes Repository: ${villa.repository.trim()}`
    : "";
  const brief = villa.projectBrief?.trim()
    ? `\nProjektziel der Villa: ${villa.projectBrief.trim()}`
    : "";
  const userLine = custom ? `\nZusätzlicher Auftrag des Benutzers: ${custom}` : "";
  return (
    `Autonome Entwicklungsmission für die Villa „${villa.villaName}“.${repository}${brief}${userLine}\n\n${VILLA_MISSION_DIRECTIVE}`
  );
}

export type StoppedMissionFacts = {
  villaName: string;
  toolActions: number;
  lastEvents: string[];
  lastEventAt?: string | null;
};

/** Ehrlicher Bericht nach dem Stopp-Knopf: keine Behauptung von Vollendung. */
export function buildStoppedMissionReport(
  facts: StoppedMissionFacts
): string {
  const events = facts.lastEvents.filter(Boolean).slice(-6);
  const timeline = events.length
    ? `\n\nLetzte Fortschrittsschritte:\n${events.map(e => `- ${e}`).join("\n")}`
    : "";
  const stamp = facts.lastEventAt ? `\n\nStopp-Zeitpunkt: ${facts.lastEventAt}` : "";
  return (
    `Die autonome Mission für „${facts.villaName}“ wurde über den Stopp-Knopf beendet und sauber abgeschlossen.\n\n` +
    `Ausgeführte GitHub-Aktionen bis zum Stopp: ${facts.toolActions}.\n` +
    `Wichtig: Bereits erstellte Branches (agent/*) oder Draft-PRs können trotzdem noch offen sein — bitte im Repository prüfen, ob ein Entwurf übernommen oder geschlossen werden soll.${timeline}${stamp}\n\n` +
    `Nächste Schritte: Missionsverlauf im Dialog öffnen, offene Entwürfe prüfen und bei Bedarf eine neue Mission mit konkretem Auftrag starten.`
  );
}
