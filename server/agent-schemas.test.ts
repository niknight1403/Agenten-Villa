import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, resetProviderChainForTests, runAgentTurn, runAgentTurnWithGitHub } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";
import { resetAgentRouterForTests } from "./agent-router";
import { resetRouterTelemetryForTests } from "./router-telemetry";
import {
  agentInputSchema,
  agentMessageSchema,
  agentResultSchema,
  isValidAgentInput,
  parseAgentInput,
  parseAgentResult,
  LIMITS_SCHEMA,
} from "./agent-schemas";

const reply = (status: number, model = "free-test") =>
  new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: "1. Ziel festlegen." } }],
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );

const baseInput = {
  prompt: "Plane kurz",
  history: [],
  mode: "home" as const,
  specialty: "Generalist",
};

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetProviderGuardianForTests();
  resetProviderChainForTests();
  resetAgentRouterForTests();
  resetRouterTelemetryForTests();
});

describe("Agentenauftragsschema (Sprint 041)", () => {
  it("akzeptiert einen vollständigen Auftrag inklusive Kontext", () => {
    const parsed = parseAgentInput({
      ...baseInput,
      history: [{ role: "user", content: "Vorher" }],
    });
    expect(parsed.mode).toBe("home");
    expect(parsed.history).toHaveLength(1);
  });

  it("streift unbekannte Eingabefelder ab (z. B. Router-Flags)", () => {
    const parsed = parseAgentInput({
      ...baseInput,
      allowHuggingFaceFallback: true,
      useGitHub: true,
      geheim: "soll verschwinden",
    });
    expect(parsed).not.toHaveProperty("allowHuggingFaceFallback");
    expect(parsed).not.toHaveProperty("useGitHub");
    expect(parsed).not.toHaveProperty("geheim");
  });

  it("lehert, trimmt und begrenzt den Prompt", () => {
    expect(isValidAgentInput({ ...baseInput, prompt: "   " })).toBe(false);
    expect(isValidAgentInput({ ...baseInput, prompt: "x".repeat(LIMITS_SCHEMA.promptChars + 1) })).toBe(false);
    expect(parseAgentInput({ ...baseInput, prompt: "  Plan  " }).prompt).toBe("Plan");
  });

  it("begrenzt Verlauf (Kontext) auf Rolle, Länge und Anzahl", () => {
    expect(agentMessageSchema.safeParse({ role: "system", content: "x" }).success).toBe(false);
    expect(agentMessageSchema.safeParse({ role: "user", content: "" }).success).toBe(false);
    expect(
      agentInputSchema.safeParse({
        ...baseInput,
        history: Array.from({ length: LIMITS_SCHEMA.historyMessages + 1 }, () => ({
          role: "user",
          content: "x",
        })),
      }).success
    ).toBe(false);
  });

  it("prüft das Ergebnis-Schema: Kernfelder Pflicht, Anbieter enumerated", () => {
    expect(
      agentResultSchema.safeParse({
        answer: "ok",
        provider: "openrouter",
        model: "m",
        attempts: 1,
      }).success
    ).toBe(true);
    expect(
      agentResultSchema.safeParse({
        answer: "",
        provider: "openrouter",
        model: "m",
        attempts: 1,
      }).success
    ).toBe(false);
    expect(
      agentResultSchema.safeParse({
        answer: "ok",
        provider: "unbekannt",
        model: "m",
        attempts: 1,
      }).success
    ).toBe(false);
  });

  it("wirft bei ungültigem Ergebnis einen INVALID_INPUT-Fehler", () => {
    expect(() =>
      parseAgentResult({ answer: "ok", provider: "openrouter", attempts: -1 })
    ).toThrowError(/Ergebnis/);
  });

  it("validiert die Eingabe an der Engine-Grenze und lehnt Ungültiges kontrolliert ab", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(200));
    const error = await runAgentTurn(
      { ...baseInput, prompt: "" },
      false,
      { fetcher }
    ).catch(e => e);
    expect(error).toBeInstanceOf(AgentError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("läuft mit schema-valider Eingabe normal und gibt ein schema-konformes Ergebnis zurück", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(200));
    const result = await runAgentTurn(baseInput, false, { fetcher });
    expect(() => parseAgentResult(result)).not.toThrow();
    expect(result.answer).toContain("Ziel");
  });

  it("streift unbekannte Felder auch in der Werkzeugrunde ab", async () => {
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
                      function: {
                        name: "github_repo_overview",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockImplementationOnce(async () => reply(200, "free-tool"));
    const executeTool = vi.fn(async () => ({ ok: true, repository: "x/y" }));
    const result = await runAgentTurnWithGitHub(
      { ...baseInput, mode: "workshop" as const, villaId: 42 },
      executeTool,
      { fetcher }
    );
    expect(executeTool).toHaveBeenCalledWith("github_repo_overview", {});
    expect(() => parseAgentResult(result)).not.toThrow();
  });
});
