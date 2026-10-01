import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentTurnWithGitHub } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";
import { resetAgentRouterForTests } from "./agent-router";
import { resetRouterTelemetryForTests } from "./router-telemetry";
import { AgentSchemaError, parseToolLoopResult } from "./agent-schemas";

const reply = (status: number, content: string | null, toolCalls?: unknown[]) =>
  new Response(
    JSON.stringify({
      model: "free-tool",
      choices: [
        {
          message: {
            content,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
          },
        },
      ],
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );

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

const validResult = {
  answer: "Fertig.",
  provider: "openrouter",
  model: "free",
  attempts: 1,
  githubActions: 2,
  completed: true,
  pullRequestOpened: false,
  pullRequest: null,
  branch: "agent/ok-1",
};

describe("Ergebnisvalidierung (Sprint 046)", () => {
  it("akzeptiert ein wohlgeformtes Werkzeugrunden-Ergebnis", () => {
    expect(() => parseToolLoopResult(validResult)).not.toThrow();
  });

  it("weist ungültige Ergebnisse sicher ab (leere Antwort, falsche Typen)", () => {
    expect(() => parseToolLoopResult({ ...validResult, answer: "" })).toThrow(AgentSchemaError);
    expect(() => parseToolLoopResult({ ...validResult, attempts: -1 })).toThrow(AgentSchemaError);
    expect(() => parseToolLoopResult({ ...validResult, completed: "ja" })).toThrow(AgentSchemaError);
    expect(() => parseToolLoopResult({ ...validResult, pullRequest: { number: "vier" } })).toThrow(AgentSchemaError);
    expect(() => parseToolLoopResult({ ...validResult, pullRequest: { number: 5, url: "keine-url", branch: "x" } })).toThrow(AgentSchemaError);
    expect(() => parseToolLoopResult({ ...validResult, branch: "" })).toThrow(AgentSchemaError);
    expect(() => parseToolLoopResult({ completed: true })).toThrow(AgentSchemaError);
  });

  it("verlangt für offene PRs Nummer, URL und Branch", () => {
    const opened = {
      ...validResult,
      completed: true,
      pullRequestOpened: true,
      pullRequest: { number: 12, url: "https://github.com/example/repo/pull/12", branch: "agent/ok-1" },
    };
    expect(() => parseToolLoopResult(opened)).not.toThrow();
    expect(() => parseToolLoopResult({ ...opened, pullRequest: { number: 12, url: "https://github.com/example/repo/pull/12" } })).toThrow(AgentSchemaError);
  });

  it("weist ein manipuliertes PR-Ergebnis der Werkzeugrunde fail-closed ab", async () => {
    // Der Werkzeug-Executor liefert eine ungueltige PR-Struktur — das
    // Ergebnis wird abgewiesen statt als sauberes Resultat durchgereicht.
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply(200, null, [
          {
            id: "call-1",
            type: "function",
            function: { name: "github_create_branch", arguments: JSON.stringify({ purpose: "t" }) },
          },
        ])
      )
      .mockResolvedValueOnce(
        reply(200, null, [
          {
            id: "call-2",
            type: "function",
            function: { name: "github_open_pull_request", arguments: JSON.stringify({ branch: "agent/t-1", title: "T", body: "B" }) },
          },
        ])
      )
      .mockResolvedValueOnce(reply(200, "Draft fertig"));
    const executeTool = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === "github_create_branch"
        ? { ok: true, result: { branch: "agent/t-1" } }
        : { ok: true, result: { number: 9, url: "keine-gueltige-url", head: "agent/t-1" } }
    );
    await expect(
      runAgentTurnWithGitHub(
        { prompt: "PR", history: [], mode: "workshop" as const, specialty: "Projekt" },
        executeTool,
        { fetcher, authorization: { administrator: true } }
      )
    ).rejects.toThrow(/Ungültiges Werkzeugrunden-Ergebnis/);
  });
});
