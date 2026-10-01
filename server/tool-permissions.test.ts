import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentTurnWithGitHub } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";
import { resetAgentRouterForTests } from "./agent-router";
import { resetRouterTelemetryForTests } from "./router-telemetry";
import {
  authorizeGitHubTool,
  GITHUB_TOOL_PERMISSIONS,
} from "./tool-permissions";

const workshop = { mode: "workshop" as const, administrator: true, sessionBranches: new Set<string>() };

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetProviderGuardianForTests();
  resetAgentRouterForTests();
  resetRouterTelemetryForTests();
});

describe("Werkzeug-Permissions (Sprint 043)", () => {
  it("führt ein vollständiges Berechtigungsregister für jedes GitHub-Werkzeug", () => {
    const registered = new Set(GITHUB_TOOL_PERMISSIONS.map(p => p.tool));
    expect(registered.size).toBe(GITHUB_TOOL_PERMISSIONS.length);
    expect(registered).toContain("github_repo_overview");
    expect(registered).toContain("github_open_pull_request");
  });

  it("autorisiert Lesewerkzeuge ohne Administrator", () => {
    const decision = authorizeGitHubTool(
      "github_read_file",
      {},
      { ...workshop, administrator: false }
    );
    expect(decision.allowed).toBe(true);
  });

  it("lehnt Schreibwerkzeuge ohne Administratorberechtigung ab", () => {
    const decision = authorizeGitHubTool(
      "github_create_branch",
      { purpose: "x" },
      { ...workshop, administrator: false }
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("Administrator");
  });

  it("lehnt unbekannte Werkzeuge fail-closed ab", () => {
    const decision = authorizeGitHubTool("github_delete_everything", {}, workshop);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("nicht im Berechtigungsregister");
  });

  it("erlaubt Schreibwerkzeuge mit Sitzungs-Branch nur auf selbst erstellten Branches", () => {
    const denied = authorizeGitHubTool(
      "github_write_file",
      { branch: "main", path: "x.ts", content: "1", message: "m" },
      { ...workshop, sessionBranches: new Set(["agent/self-1"]) }
    );
    expect(denied.allowed).toBe(false);
    const allowed = authorizeGitHubTool(
      "github_write_file",
      { branch: "agent/self-1", path: "x.ts", content: "1", message: "m" },
      { ...workshop, sessionBranches: new Set(["agent/self-1"]) }
    );
    expect(allowed.allowed).toBe(true);
  });

  it("lehnt Werkzeuge außerhalb der Werkstatt ab (defense in depth)", () => {
    const decision = authorizeGitHubTool(
      "github_repo_overview",
      {},
      { ...workshop, mode: "home" }
    );
    expect(decision.allowed).toBe(false);
  });

  it("führt einen Schreibzugriff ohne Autorisierung in der Engine NIE aus", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify({
            model: "free-tool",
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: { name: "github_write_file", arguments: JSON.stringify({ branch: "agent/x", path: "a.ts", content: "1", message: "m" }) },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify({ model: "free-tool", choices: [{ message: { content: "Abgebrochen." } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    const executeTool = vi.fn(async () => ({ ok: true }));
    // Ohne authorization-Dep ist die Runde fail-closed: administrator=false
    const result = await runAgentTurnWithGitHub(
      { prompt: "Schreibe", history: [], mode: "workshop" as const, specialty: "Projekt" },
      executeTool,
      { fetcher }
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.githubActions).toBe(0);
    const toolMessage = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body)
    ).messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMessage.content).toContain("Administratorberechtigung");
  });
});
