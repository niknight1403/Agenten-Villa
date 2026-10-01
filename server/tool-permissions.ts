/**
 * Sprint 043 — Werkzeug-Permissions: Tools werden vor der Ausführung
 * autorisiert. Eine zentrale, explizite Autorisierungsschicht entscheidet
 * VOR jedem Werkzeugaufruf — fail-closed: unbekannte Werkzeuge und fehlende
 * Berechtigung führen immer zur Ablehnung, nie zur Ausführung.
 */

export type ToolCategory = "read" | "write";

export type ToolPermission = {
  tool: string;
  category: ToolCategory;
  /** Schreibwerkzeuge erfordern Administratorberechtigung. */
  requiresAdministrator: boolean;
  /**
   * Schreibwerkzeuge mit Sitzungs-Branch-Pflicht dürfen nur auf einem Branch
   * arbeiten, der in derselben Anfrage bzw. Elite-Mission vom Agenten
   * erstellt wurde.
   */
  requiresSessionBranch: boolean;
};

export const GITHUB_TOOL_PERMISSIONS: readonly ToolPermission[] = [
  { tool: "github_repo_overview", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_list_commits", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_list_files", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_list_tree", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_read_file", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_list_issues", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_list_pull_requests", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_check_runs", category: "read", requiresAdministrator: false, requiresSessionBranch: false },
  { tool: "github_create_branch", category: "write", requiresAdministrator: true, requiresSessionBranch: false },
  { tool: "github_write_file", category: "write", requiresAdministrator: true, requiresSessionBranch: true },
  { tool: "github_open_pull_request", category: "write", requiresAdministrator: true, requiresSessionBranch: true },
] as const;

const PERMISSION_INDEX = new Map<string, ToolPermission>(
  GITHUB_TOOL_PERMISSIONS.map(permission => [permission.tool, permission])
);

export type ToolAuthorizationContext = {
  /** Werkstatt-Modus ist Voraussetzung für alle GitHub-Werkzeuge. */
  mode: "home" | "workshop";
  /** Der Aufrufer ist Administrator (Router hat dies bereits geprüft). */
  administrator: boolean;
  /** In dieser Anfrage/Mission vom Agenten erstellte Branches. */
  sessionBranches: ReadonlySet<string>;
};

export type ToolAuthorizationDecision =
  | { allowed: true; permission: ToolPermission }
  | { allowed: false; reason: string; permission?: ToolPermission };

/** Autorisiert einen Werkzeugaufruf VOR der Ausführung (fail-closed). */
export function authorizeGitHubTool(
  tool: string,
  args: { branch?: unknown },
  context: ToolAuthorizationContext
): ToolAuthorizationDecision {
  const permission = PERMISSION_INDEX.get(tool);
  if (!permission)
    return {
      allowed: false,
      reason: `Werkzeug ${tool} ist nicht im Berechtigungsregister eingetragen und wird nicht ausgeführt.`,
    };

  if (context.mode !== "workshop")
    return {
      allowed: false,
      reason:
        "GitHub-Werkzeuge sind ausschließlich in der Projekt-Werkstatt verfügbar.",
      permission,
    };

  if (permission.requiresAdministrator && !context.administrator)
    return {
      allowed: false,
      reason: `Werkzeug ${tool} erfordert Administratorberechtigung.`,
      permission,
    };

  if (
    permission.requiresSessionBranch &&
    (typeof args.branch !== "string" || !context.sessionBranches.has(args.branch))
  )
    return {
      allowed: false,
      reason:
        "Schreibzugriff ist nur auf einem Branch erlaubt, der in dieser Anfrage bzw. Elite-Mission vom Agenten erstellt wurde.",
      permission,
    };

  return { allowed: true, permission };
}
