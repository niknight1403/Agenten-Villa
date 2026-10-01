import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentError, LIMITS, parseRetryAfterSeconds, resetProviderChainForTests, runAgentTurn, runAgentTurnWithGitHub, verifyOpenRouterKey } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";

const input = { prompt: "Erstelle einen kurzen Plan", history: [], mode: "home" as const, specialty: "Generalist" };
const workshopInput = { ...input, prompt: "Zeige den Repo-Überblick", mode: "workshop" as const };
const reply = (status: number, model = "free-test") => new Response(JSON.stringify({ model, choices: [{ message: { content: "1. Ziel festlegen. 2. Ergebnis prüfen." } }] }), { status, headers: { "Content-Type": "application/json" } });
const toolReply = (id: string, name: string, args: unknown) => new Response(JSON.stringify({ model: "free-tool-model", choices: [{ message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); resetProviderGuardianForTests(); resetProviderChainForTests(); });

describe("bounded provider router", () => {
  it("calls OpenRouter Free once and returns provider metadata", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200));
    await expect(runAgentTurn(input, false, { fetcher })).resolves.toMatchObject({ provider: "openrouter", attempts: 1, answer: expect.stringContaining("Ziel") });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("keeps Hugging Face consent-gated: no HF fallback without explicit opt-in", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("HF_TOKEN", "hf-test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(429));
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toMatchObject({ code: "LIMIT" });
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

  it("follows the configured fallback order deterministically (Sprint 032)", async () => {
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("PROVIDER_FALLBACK_ORDER", "gemini,groq");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(200, "groq-model"));
    await expect(runAgentTurn(input, false, { fetcher })).resolves.toMatchObject({
      provider: "groq",
      attempts: 2,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.groq.com/openai/v1/chat/completions"
    );
  });

  it("stops clearly when the primary server key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetcher = vi.fn<typeof fetch>();
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toBeInstanceOf(AgentError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Rate-Limit-Erkennung (Sprint 033)", () => {
  it("klassifiziert 429 als LIMIT und liest Retry-After in Sekunden", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limit" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "42" },
      })
    );
    const outcome = await runAgentTurn(input, false, { fetcher }).catch(
      error => error
    );
    expect(outcome).toBeInstanceOf(AgentError);
    expect(outcome).toMatchObject({
      code: "LIMIT",
      status: 429,
      retryAfterSeconds: 42,
    });
    expect(outcome.message).toContain("42 Sekunden");
  });

  it("klassifiziert 402 als LIMIT ohne geratenen Retry-After", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(402));
    const outcome = await runAgentTurn(input, false, { fetcher }).catch(
      error => error
    );
    expect(outcome).toMatchObject({
      code: "LIMIT",
      status: 402,
      retryAfterSeconds: undefined,
    });
    expect(outcome.message).not.toContain("Sekunden");
  });

  it("klassifiziert Timeouts als TIMEOUT, nicht als Unerreichbarkeit", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    const outcome = await runAgentTurn(input, false, { fetcher }).catch(
      error => error
    );
    expect(outcome).toMatchObject({ code: "TIMEOUT" });
    expect(outcome.message).toContain("Zeitlimit");
  });

  it("lässt Netzwerkfehler als UNAVAILABLE unverändert", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    const outcome = await runAgentTurn(input, false, { fetcher }).catch(
      error => error
    );
    expect(outcome).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("fällt bei TIMEOUT auf den nächsten Anbieter durch", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))
      .mockResolvedValueOnce(reply(200, "groq-model"));
    await expect(runAgentTurn(input, false, { fetcher })).resolves.toMatchObject({
      provider: "groq",
      attempts: 2,
    });
  });

  it("parst Retry-After als Sekunden oder HTTP-Datum, sonst undefined", () => {
    const now = new Date("2026-10-01T20:00:00Z");
    expect(parseRetryAfterSeconds("42", now)).toBe(42);
    expect(parseRetryAfterSeconds(" 42 ", now)).toBe(42);
    expect(
      parseRetryAfterSeconds("Thu, 01 Oct 2026 20:01:00 GMT", now)
    ).toBe(60);
    expect(parseRetryAfterSeconds("Thu, 01 Oct 2026 19:59:00 GMT", now)).toBe(0);
    expect(parseRetryAfterSeconds("nonsens", now)).toBeUndefined();
    expect(parseRetryAfterSeconds(null, now)).toBeUndefined();
    //"-5" wird von JS als vergangenes Datum (Jahr -5) gelesen: 0 statt geraten
    expect(parseRetryAfterSeconds("-5", now)).toBe(0);
  });
});

describe("free-tier optimization (cache, dedupe, model chain)", () => {
  it("serves identical requests from the cache without a second provider call", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("FREE_TIER_CACHE", "1");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200, "free-cache-model"));
    const first = await runAgentTurn(input, false, { fetcher });
    const second = await runAgentTurn(input, false, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ provider: "openrouter" });
    expect(first.cached).toBeUndefined();
    expect(second).toMatchObject({ provider: "openrouter", model: "free-cache-model", attempts: 0, cached: true });
    expect(second.answer).toBe(first.answer);
  });

  it("respects an explicit cache disable via FREE_TIER_CACHE=0", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("FREE_TIER_CACHE", "0");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(200));
    await runAgentTurn(input, false, { fetcher });
    await runAgentTurn(input, false, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesces identical concurrent requests into a single provider call", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("FREE_TIER_CACHE", "0");
    const fetcher = vi.fn<typeof fetch>(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      return reply(200);
    });
    const [first, second] = await Promise.all([
      runAgentTurn(input, false, { fetcher }),
      runAgentTurn(input, false, { fetcher }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.answer).toBe(first.answer);
  });

  it("tries the next free model when the first hits a provider rate limit", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("FREE_TIER_CACHE", "0");
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free, model-b:free");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(200, "model-b-live"));
    await expect(runAgentTurn(input, true, { fetcher })).resolves.toMatchObject({
      model: "model-b-live",
      attempts: 2,
    });
    const firstPayload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const secondPayload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(firstPayload.model).toBe("model-a:free");
    expect(secondPayload.model).toBe("model-b:free");
  });

  it("does not fake a quota bypass: hard LIMIT after the whole chain stays a LIMIT error", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("HF_TOKEN", "hf-test-key");
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(402));
    await expect(runAgentTurn(input, true, { fetcher })).rejects.toMatchObject({ code: "LIMIT" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("bounded GitHub tool loop", () => {
  it("runs a tool only in workshop mode, sends its result back to OpenRouter, and returns a summary", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(toolReply("call-1", "github_repo_overview", {})).mockResolvedValueOnce(reply(200, "free-tool-model"));
    const executeTool = vi.fn(async () => ({ repository: "niknight1403/Agenten-Villa", defaultBranch: "main" }));
    const result = await runAgentTurnWithGitHub(workshopInput, executeTool, { fetcher });
    expect(result).toMatchObject({ provider: "openrouter", model: "free-tool-model", githubActions: 1, answer: expect.stringContaining("Ziel") });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("github_repo_overview", {});
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(firstPayload.model).toBe("openrouter/free");
    expect(firstPayload.tools.some((tool: { function: { name: string } }) => tool.function.name === "github_read_file")).toBe(true);
    const secondPayload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(secondPayload.messages.some((message: { role: string; tool_call_id?: string }) => message.role === "tool" && message.tool_call_id === "call-1")).toBe(true);
  });

  it("caps GitHub tool execution at three actions per chat turn", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const repeated = () => toolReply("call-loop", "github_repo_overview", {});
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => repeated());
    const executeTool = vi.fn(async () => ({ ok: true }));
    const result = await runAgentTurnWithGitHub(workshopInput, executeTool, { fetcher });
    expect(executeTool).toHaveBeenCalledTimes(LIMITS.githubActionsPerTurn);
    expect(fetcher).toHaveBeenCalledTimes(LIMITS.githubToolRounds + 1);
    expect(result.githubActions).toBe(LIMITS.githubActionsPerTurn);
  });

  it("allows a write only after this turn successfully created its agent branch", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const branch = "agent/docs-update-123abc";
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(toolReply("call-branch", "github_create_branch", { purpose: "docs update" }))
      .mockResolvedValueOnce(toolReply("call-write", "github_write_file", { path: "docs/note.md", branch, content: "note", message: "docs: add note" }))
      .mockResolvedValueOnce(reply(200, "free-tool-model"));
    const executeTool = vi.fn(async (name: string) => name === "github_create_branch" ? { result: { branch } } : { result: { path: "docs/note.md", branch } });
    const result = await runAgentTurnWithGitHub(workshopInput, executeTool, { fetcher });
    expect(result.githubActions).toBe(2);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, "github_create_branch", { purpose: "docs update" });
    expect(executeTool).toHaveBeenNthCalledWith(2, "github_write_file", expect.objectContaining({ branch }));
  });

  it("never executes a file write on a branch not created in the same request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(toolReply("call-write", "github_write_file", { path: "README.md", branch: "agent/old-work", content: "x", message: "update" })).mockResolvedValueOnce(reply(200, "free-tool-model"));
    const executeTool = vi.fn(async () => ({ ok: true }));
    const result = await runAgentTurnWithGitHub(workshopInput, executeTool, { fetcher });
    expect(result.githubActions).toBe(0);
    expect(executeTool).not.toHaveBeenCalled();
    const finalPayload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const toolMessage = finalPayload.messages.find((message: { role: string }) => message.role === "tool");
    expect(toolMessage.content).toContain("Branch");
  });
});

describe("OpenRouter API key verification", () => {
  it("checks the official read-only status endpoint and returns no key material", async () => {
    const key = "sk-or-test-secret-value";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await verifyOpenRouterKey(key, fetcher);
    expect(result).toBe("valid");
    expect(fetcher).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", expect.objectContaining({ method: "GET", headers: { Authorization: `Bearer ${key}` } }));
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("marks rejected credentials invalid without exposing provider response text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret must never be returned", { status: 401 }));
    await expect(verifyOpenRouterKey("sk-or-invalid-test", fetcher)).resolves.toBe("invalid");
  });

  it("fails closed as unavailable on rate limits and network failures", async () => {
    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 429 }));
    await expect(verifyOpenRouterKey("sk-or-test-key", limited)).resolves.toBe("unavailable");
    const networkFailure = vi.fn<typeof fetch>().mockRejectedValue(new Error("transport error"));
    await expect(verifyOpenRouterKey("sk-or-test-key", networkFailure)).resolves.toBe("unavailable");
  });
});

describe("admin system prompt override", () => {
  it("replaces the default persona when set and keeps it when empty", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200));
    await runAgentTurn({ ...input, systemOverride: "  Du bist der Test-Override.  " }, false, { fetcher });
    const body = JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("Du bist der Test-Override.");
    expect(body.messages[0]?.content).not.toContain("Agenten-Villa-Assistent");

    const fetcher2 = vi.fn<typeof fetch>().mockResolvedValue(reply(200));
    await runAgentTurn({ ...input, systemOverride: "   " }, false, { fetcher: fetcher2 });
    const body2 = JSON.parse((fetcher2.mock.calls[0]?.[1] as RequestInit).body as string) as { messages: Array<{ content: string }> };
    expect(body2.messages[0]?.content).toContain("Agenten-Villa-Assistent");
  });

  it("keeps the GitHub tool-safety block even with an override active", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200));
    await runAgentTurnWithGitHub({ ...workshopInput, systemOverride: "Override-Modus" }, async () => ({ ok: true, summary: "noop", created: [] }), { fetcher });
    const body = JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string) as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("Override-Modus");
    expect(body.messages[0]?.content).toContain("GitHub-Werkzeuge sind für diese Anfrage aktiviert");
  });
});

describe("multi-provider failover chain", () => {
  it("fails over from OpenRouter to Groq when the free quota is exhausted", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(200, "groq-model-live"));
    await expect(runAgentTurn(input, false, { fetcher })).resolves.toMatchObject({
      provider: "groq",
      model: "groq-model-live",
      attempts: 2,
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("skips a provider with an invalid key and answers via the next one", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-invalid");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(401))
      .mockResolvedValueOnce(reply(200, "gemini-model-live"));
    await expect(runAgentTurn(input, false, { fetcher })).resolves.toMatchObject({
      provider: "gemini",
      attempts: 3,
    });
    expect(fetcher.mock.calls[2]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });

  it("treats a content rejection as terminal and does not shop around providers", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(400));
    await expect(runAgentTurn(input, false, { fetcher })).rejects.toMatchObject({ code: "REJECTED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("runs a GitHub tool loop through Groq when the OpenRouter quota is gone", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "groq-test-key");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply(429))
      .mockResolvedValueOnce(reply(200, "groq-tool-model"));
    const executeTool = vi.fn(async () => ({ ok: true }));
    const result = await runAgentTurnWithGitHub(workshopInput, executeTool, { fetcher });
    expect(result).toMatchObject({ provider: "groq", model: "groq-tool-model" });
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });
});
