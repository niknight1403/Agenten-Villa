import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentError, runAgentTurn } from "./agent-engine";

const input = { prompt: "Erstelle einen kurzen Plan", history: [], mode: "home" as const, specialty: "Generalist" };
const reply = (status: number, model = "free-test") => new Response(JSON.stringify({ model, choices: [{ message: { content: "1. Ziel festlegen. 2. Ergebnis prüfen." } }] }), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("bounded provider router", () => {
  it("calls OpenRouter Free once and returns provider metadata", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200));
    await expect(runAgentTurn(input, false, { fetcher })).resolves.toMatchObject({ provider: "openrouter", attempts: 1, answer: expect.stringContaining("Ziel") });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("never falls back on exhausted provider quota", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("HF_TOKEN", "hf-test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(429));
    await expect(runAgentTurn(input, true, { fetcher })).rejects.toMatchObject({ code: "LIMIT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses at most one explicitly authorized HF fallback after a temporary failure", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("HF_TOKEN", "hf-test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, "hf-model"));
    await expect(runAgentTurn(input, true, { fetcher })).resolves.toMatchObject({ provider: "huggingface", attempts: 2, model: "hf-model" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://router.huggingface.co/v1/chat/completions");
  });

  it("stops clearly when the primary server key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetcher = vi.fn<typeof fetch>();
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toBeInstanceOf(AgentError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
