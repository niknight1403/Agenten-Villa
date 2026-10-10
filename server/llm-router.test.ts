import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  fetchWithFallback,
  registerLLMProvider,
  resetLLMProvidersForTests,
  setRegisteredProviderOrder,
  assertAnyApiKey,
} from "./_core/llm-router";

/**
 * Sprint-Audit — Ollama-Route im zentralen Fallback-Router:
 * Ohne OLLAMA_BASE_URL bleibt die Route inaktiv, mit voller Konfiguration
 * liegt sie an erster Stelle (Ollama-first) und bekommt ihr Default-Modell
 * aus OLLAMA_MODELS bzw. dem Code-Default.
 */

const originalEnv = { ...process.env };

function stubFetchSequence(responses: Array<Response | Error>) {
  let call = 0;
  const mock = vi.fn(async () => {
    const next = responses[call] ?? new Error("keine Antwort mehr definiert");
    call += 1;
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Test-Fallback-Provider per Sprint-095-Erweiterungspunkt. */
function registerTestCloud(): void {
  registerLLMProvider({
    name: "testcloud",
    url: "https://testcloud.example/v1/chat/completions",
    apiKey: () => "test-key",
    model: "test-model",
    authHeader: (key) => ({ authorization: `Bearer ${key}` }),
  });
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("LLM-Router: Ollama-Route (Audit Abschnitt 1)", () => {
  beforeEach(() => {
    resetLLMProvidersForTests();
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_MODELS;
    process.env.OPENROUTER_API_KEY = "";
    process.env.GROQ_API_KEY = "";
    process.env.GEMINI_API_KEY = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(originalEnv)) {
      process.env[key] = originalEnv[key];
    }
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
  });

  it("hat Ollama als ersten registrierten Provider (Ollama-first)", async () => {
    const { getRegisteredProviders } = await import("./_core/llm-router");
    expect(getRegisteredProviders()[0]?.name).toBe("ollama");
  });

  it("ueberspringt Ollama ohne OLLAMA_BASE_URL und faellt auf den naechsten Provider zurueck", async () => {
    process.env.OLLAMA_API_KEY = "villa-token";
    registerTestCloud();
    const mock = stubFetchSequence([jsonResponse(200, { ok: true })]);

    const response = await fetchWithFallback(
      { messages: [] },
      { method: "POST", headers: {}, body: "{}" },
    );
    expect(response.ok).toBe(true);
    const [url] = mock.mock.calls[0] as unknown as [string];
    expect(String(url)).toContain("testcloud.example");
  });

  it("ruft Ollama zuerst auf, wenn OLLAMA_BASE_URL und Token gesetzt sind", async () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.example.com/v1";
    process.env.OLLAMA_API_KEY = "villa-token";
    process.env.OLLAMA_MODELS = "gemma4:12b,devstral:24b";
    registerTestCloud();
    const mock = stubFetchSequence([jsonResponse(200, { ok: true })]);

    await fetchWithFallback(
      { messages: [] },
      { method: "POST", headers: {}, body: "{}" },
    );

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://ollama.example.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer villa-token");
    const body = JSON.parse(String(init.body)) as { model?: string };
    expect(body.model).toBe("gemma4:12b");
  });

  it("ergaenzt das Ollama-Default-Modell aus dem Code-Fallback (gemma4:12b)", async () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.example.com/v1";
    process.env.OLLAMA_API_KEY = "villa-token";
    const mock = stubFetchSequence([jsonResponse(200, { ok: true })]);

    await fetchWithFallback(
      { messages: [] },
      { method: "POST", headers: {}, body: "{}" },
    );

    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { model?: string };
    expect(body.model).toBe("gemma4:12b");
  });

  it("folgt der Rangordnung des Rotators (setRegisteredProviderOrder)", async () => {
    setRegisteredProviderOrder(["openrouter", "ollama", "groq", "gemini"]);
    const { getRegisteredProviders } = await import("./_core/llm-router");
    const names = getRegisteredProviders().map((p) => p.name);
    expect(names[0]).toBe("openrouter");
    expect(names).toContain("ollama");
  });

  it("akzeptiert Ollama-Credentials als ausreichenden Key in assertAnyApiKey", () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.example.com/v1";
    process.env.OLLAMA_API_KEY = "villa-token";
    expect(() => assertAnyApiKey()).not.toThrow();
  });

  it("wirft in assertAnyApiKey, wenn gar kein Key konfiguriert ist", () => {
    expect(() => assertAnyApiKey()).toThrow(/Kein LLM-API-Key/);
  });
});
