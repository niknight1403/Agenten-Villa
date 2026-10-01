/**
 * Sprint 051 — Rollenmodell: Administrator, Operator und Viewer sind
 * getrennt. Viewer lesen und chatten; Operatoren steuern zusätzlich den
 * Agentenbetrieb (Start/Stop); Administratoren erhalten zusätzlich alle
 * geschützten Endpunkte (Elite-Missionen, Prompts, Metriken, Konfiguration).
 *
 * Rollen kommen aus dem User-Datensatz (role-Spalte) oder — ohne manuelle
 * Konfiguration im Nutzerdatensatz — aus den Allowlists
 * AGENT_ADMIN_EMAIL bzw. AGENT_OPERATOR_EMAIL.
 */

import { TRPCError } from "@trpc/server";

export type AgentRole = "admin" | "operator" | "viewer";

export type RoleBearer = { role: string; email?: string | null };

export const ROLE_RANK: Record<AgentRole, number> = { viewer: 0, operator: 1, admin: 2 };

function allowlisted(email: string | null | undefined, allowlistEnv: string | undefined): boolean {
  const allowlist = allowlistEnv?.trim().toLowerCase();
  return Boolean(allowlist && email?.trim().toLowerCase() === allowlist);
}

/** Ermittelt die wirksame Rolle: Allowlist-Admin schlägt alles, danach DB-Rolle. */
export function resolveAgentRole(user: RoleBearer): AgentRole {
  if (allowlisted(user.email, process.env.AGENT_ADMIN_EMAIL)) return "admin";
  if (user.role === "admin") return "admin";
  if (allowlisted(user.email, process.env.AGENT_OPERATOR_EMAIL)) return "operator";
  if (user.role === "operator") return "operator";
  return "viewer";
}

export function roleAtLeast(user: RoleBearer, minimum: AgentRole): boolean {
  return ROLE_RANK[resolveAgentRole(user)] >= ROLE_RANK[minimum];
}

/** Fordert eine Mindestrolle; bei Unterschreitung FORBIDDEN mit Klartext. */
export function requireRole(user: RoleBearer, minimum: AgentRole): void {
  if (!roleAtLeast(user, minimum)) {
    const labels: Record<AgentRole, string> = {
      admin: "Administrator",
      operator: "Operator oder Administrator",
      viewer: "angemeldete Nutzer",
    };
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Diese Aktion erfordert die Rolle ${labels[minimum]} (aktuelle Rolle: ${resolveAgentRole(user)}).`,
    });
  }
}
