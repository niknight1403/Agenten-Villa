/**
 * Sprint 092 — Rollenbasierte Dashboards: die sichtbaren Dashboard-
 * Inhalte pro Rolle sind ZENTRAL definiert und der Client fragt sie
 * beim Server ab, statt eigene Rolllogik zu raten.
 *
 * Regeln:
 *  - Viewer: Villa-Übersicht, Chats, Token-Budget, Onboarding-Hilfen.
 *  - Operator (Rang 1): zusätzlich Missionssteuerung und Controller.
 *  - Administrator (Rang 2): zusätzlich Elite-Missionen, Admin-Metriken,
 *    Routing-Panel und Anbieterkonfiguration.
 *
 * Die Reihenfolge ist bewusst stabil: das Dashboard rendert die
 * Abschnitte in dieser Reihenfolge; Reihenfolge = Priorität im UI.
 */

import { ROLE_RANK, type AgentRole } from "./roles";

export type DashboardSectionId =
  | "villa_overview"
  | "token_budget"
  | "onboarding"
  | "villa_mission"
  | "controller"
  | "elite_mission"
  | "admin_metrics"
  | "routing"
  | "provider_config";

export type DashboardSection = {
  id: DashboardSectionId;
  /** Mindestrolle, um den Abschnitt zu sehen. */
  minimumRole: AgentRole;
};

export const DASHBOARD_SECTIONS: DashboardSection[] = [
  { id: "villa_overview", minimumRole: "viewer" },
  { id: "token_budget", minimumRole: "viewer" },
  { id: "onboarding", minimumRole: "viewer" },
  { id: "villa_mission", minimumRole: "operator" },
  { id: "controller", minimumRole: "operator" },
  { id: "elite_mission", minimumRole: "admin" },
  { id: "admin_metrics", minimumRole: "admin" },
  { id: "routing", minimumRole: "admin" },
  { id: "provider_config", minimumRole: "admin" },
];

export type DashboardLayout = {
  role: AgentRole;
  /** Sichtbare Abschnitte in Render-Reihenfolge (nie null, nie Duplikate). */
  sections: DashboardSectionId[];
};

/** Reine Layout-Berechnung: sichtbare Abschnitte je Rolle. */
export function dashboardLayoutForRole(role: AgentRole): DashboardLayout {
  const sections = DASHBOARD_SECTIONS.filter(
    (section) => ROLE_RANK[section.minimumRole] <= ROLE_RANK[role]
  ).map((section) => section.id);
  return { role, sections };
}

/** Prueffunktion: enthaelt das Layout einen Abschnitt? */
export function layoutHasSection(
  layout: DashboardLayout | undefined,
  section: DashboardSectionId
): boolean {
  return Boolean(layout?.sections.includes(section));
}
