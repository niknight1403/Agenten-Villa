import { TRPCError } from "@trpc/server";

/**
 * Sprint 047 — Human-in-the-loop-Punkte: riskante Aktionen werden als
 * Freigabepunkte markiert. Jede Freigabe hat eine feste Kennung, eine
 * Klartext-Beschreibung und einen verpflichtenden Bestätigungstext.
 * Ausgeführt wird nur, was ausdrücklich über den zugehörigen Freigabe-
 * Parameter quittiert wurde — der Router fragt jeden Punkt zentral ab.
 */

export type ApprovalGate = {
  id: string;
  label: string;
  description: string;
  acknowledgement: string;
};

export const APPROVAL_GATES: readonly ApprovalGate[] = [
  {
    id: "mission-start",
    label: "Elite-Mission starten",
    description: "Eine Elite-Mission löst echte GitHub-Aktionen aus (Branches, Dateiänderungen, Draft-PR) und verbraucht Modellkontingente.",
    acknowledgement: "Ich habe verstanden, dass diese Mission echte GitHub-Änderungen auslöst, und gebe sie ausdrücklich frei.",
  },
  {
    id: "live-trading-keys",
    label: "Echte Trading-API-Keys fuer Live-Handel einbinden",
    description: "Live-Handel setzt ein bestandenes Simulations-Gate voraus (Mindest-Win-Rate 68 % ueber mindestens 500 simulierte Trades, stabiler Profit-Faktor, Fenster < 24 h — siehe server/trading-gate.ts). Diese Freigabe ist zusaetzlich zum Gate und nie autonom.",
    acknowledgement: "Ich habe die Simulationskennzahlen geprueft (>= 68 % Win-Rate, >= 500 Trades, stabiler Profit-Faktor) und binde echte Trading-API-Keys ausdruecklich fuer den Live-Handel ein.",
  },
  {
    id: "mission-restart",
    label: "Unterbrochene Mission neu starten",
    description: "Der vorherige Versuch kann bereits Branches, Dateien oder einen Draft-PR verändert haben; ein Neustart kann weitere Seitenwirkungen erzeugen.",
    acknowledgement: "Ich habe die bisherigen GitHub-Änderungen geprüft und starte ausdrücklich neu.",
  },
  {
    id: "controller-stop",
    label: "Agentenbetrieb anhalten",
    description: "STOPPED beendet den Agentenbetrieb für alle Konten bis zur erneuten Freigabe.",
    acknowledgement: "Ich halte den Agentenbetrieb ausdrücklich an.",
  },
] as const;

const GATE_INDEX = new Map(APPROVAL_GATES.map(gate => [gate.id, gate]));

/** Liefert den Freigabepunkt mit Beschreibung und Bestätigungstext. */
export function approvalPoint(id: string): ApprovalGate {
  const gate = GATE_INDEX.get(id);
  if (!gate) throw new Error(`UNBEKANNTER_FREIGABEPUNKT:${id}`);
  return gate;
}

/** Wirft BAD_REQUEST, wenn die Freigabe nicht ausdrücklich quittiert wurde. */
export function requireApproval(id: string, acknowledged: boolean): void {
  const gate = approvalPoint(id);
  if (!acknowledged)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Freigabepunkt „${gate.label}“: ${gate.acknowledgement}`,
    });
}
