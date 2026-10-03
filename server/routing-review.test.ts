/**
 * Sprint 040 — Routing-Review: Provider- und Sicherheitsregressionen sind
 * gruen. Diese Suite buendelt die Invarianten des Provider-Routings und der
 * Sicherheitsgrenzen an einem Ort — jede einzelne Regel ist zwar auch
 * dort getestet, wo sie entstanden ist; hier wird geprueft, dass sie
 * ZUSAMMEN gelten. Alles gegen Mocks, ohne echten Netzwerkverkehr.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { AgentError, resetProviderChainForTests, runAgentTurn } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";
import { resetAgentRouterForTests } from "./agent-router";
import { resetRouterTelemetryForTests, routerTelemetrySummary } from "./router-telemetry";
import { clearProviderCooldownsForTests, providerInCooldown } from "./provider-cooldown";
import type { TrpcContext } from "./_core/context";

const reply = (status: number, model = "free-test") =>
  new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: "1. Ziel festlegen." } }],
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );

const input = { prompt: "Plane kurz", history: [], mode: "home" as const, specialty: "Generalist" };

function createContext(role: "user" | "admin", email: string): TrpcContext {
  return {
    user: {
      id: 17,
      openId: "test-open-id",
      email,
      name: "Test User",
      loginMethod: "test",
      role,
      createdAt: new Date(),
    },
  } as unknown as TrpcContext;
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "or-secret-key");
  vi.stubEnv("GROQ_API_KEY", "groq-secret-key");
  vi.stubEnv("GEMINI_API_KEY", "gemini-secret-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetProviderGuardianForTests();
  resetProviderChainForTests();
  resetAgentRouterForTests();
  resetRouterTelemetryForTests();
  clearProviderCooldownsForTests();
});

describe("Routing-Review: Provider-Invarianten (Sprint 040)", () => {
  it("hält die dokumentierte Failover-Reihenfolge ein: OpenRouter → Groq → Gemini", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(reply(429, "or-1")))
      .mockImplementationOnce(() => Promise.resolve(reply(429, "or-1")))
      .mockImplementationOnce(() => Promise.resolve(reply(429, "or-1")))
      .mockImplementationOnce(() => Promise.resolve(reply(200, "groq-model")));
    const outcome = await runAgentTurn(input, false, { fetcher });
    expect(outcome.provider).toBe("groq");
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions"
    );
    expect(fetcher.mock.calls[3][0]).toBe(
      "https://api.groq.com/openai/v1/chat/completions"
    );
  });

  it("behandelt inhaltliche Ablehnungen als terminal — kein Anbieter-Vorschub", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "content policy" } }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
    );
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toMatchObject({
      code: "REJECTED",
    });
    // Terminal heißt terminal: nach der Ablehnung wird kein weiterer Anbieter befragt.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("schließt bei Auth-Fehlern den ganzen Anbieter und ohne Alternative bleibt fail-closed", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(401));
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toMatchObject({
      code: "AUTH",
    });
    expect(providerInCooldown("openrouter")).toBe(true);
  });

  it("läuft ohne jeden konfigurierten Schlüssel fail-closed auf MISSING_KEY", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("HF_TOKEN", "");
    const fetcher = vi.fn<typeof fetch>();
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toMatchObject({
      code: "MISSING_KEY",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bleibt Hugging Face einwilligungsgated — keine HF-Route ohne Consent", async () => {
    vi.stubEnv("HF_TOKEN", "hf-secret");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(429));
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toMatchObject({
      code: "LIMIT",
    });
    const urls = fetcher.mock.calls.map(call => String(call[0]));
    expect(urls.some(url => url.includes("huggingface"))).toBe(false);
  });
});

describe("Routing-Review: Sicherheits-Invarianten (Sprint 040)", () => {
  it("leakt keine Geheimnisse in Fehlermeldungen oder Telemetrie", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(500));
    const error = await runAgentTurn(input, false, { fetcher }).catch(e => e);
    expect(error).toBeInstanceOf(AgentError);
    expect(String(error.message)).not.toContain("or-secret-key");
    expect(String(error.message)).not.toContain("groq-secret-key");
    const summary = routerTelemetrySummary();
    expect(summary.turns).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("or-secret-key");
  });

  it("schützt steuernde Endpunkte für Nicht-Administratoren", async () => {
    const user = appRouter.createCaller(createContext("user", "user@example.com"));
    await expect(user.agent.setState({ state: "STOPPED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(user.agent.routerTelemetry()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      user.agent.providerHealth({ provider: "groq" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("klassifiziert Erschöpfung ehrlich als LIMIT mit dokumentiertem Retry-After", async () => {
    // Sprint 079 — Erholungswartebudget auf 1 ms: das 42-s-Fenster liegt
    // ausserhalb, also bleibt es beim ehrlichen LIMIT-Fehler.
    vi.stubEnv("ROUTE_WAIT_BUDGET_MS", "1");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: "limit" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "42" },
        })
    );
    const error = await runAgentTurn(input, false, { fetcher }).catch(e => e);
    expect(error).toMatchObject({ code: "LIMIT", retryAfterSeconds: 42 });
    expect(providerInCooldown("openrouter")).toBe(true);
  });

  it("verhindert Schreib-Werkzeuge ohne in dieser Runde erzeugten Branch", async () => {
    const { runAgentTurnWithGitHub } = await import("./agent-engine");
    const toolCall = new Response(
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
                    name: "github_write_file",
                    arguments: JSON.stringify({
                      path: "src/x.ts",
                      content: "x",
                      message: "x",
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => toolCall)
      .mockImplementationOnce(async () => reply(200, "free-tool"));
    const executeTool = vi.fn(async () => ({ ok: true }));
    const workshopInput = { ...input, mode: "workshop" as const };
    const outcome = await runAgentTurnWithGitHub(workshopInput, executeTool, {
      fetcher,
    });
    // Ohne eigenen Branch wird der Schreibversuch VOR der Ausführung
    // abgewiesen — das Werkzeug läuft nie.
    expect(executeTool).not.toHaveBeenCalled();
    expect(outcome.githubActions).toBe(0);
    expect(outcome.answer).toContain("Ziel");
  });
});
