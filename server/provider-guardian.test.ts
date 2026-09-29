import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeRoute,
  getGuardianSnapshot,
  guardianChain,
  reportProviderOutcome,
  resetProviderGuardianForTests,
  runGuardianCycle,
  setGuardianEnabled,
} from "./provider-guardian";

const chatOk = (model: string) =>
  new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: "pong" } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const status = (code: number) =>
  new Response(JSON.stringify({ error: "x" }), { status: code });

const catalogOk = new Response(JSON.stringify({ data: [] }), { status: 200 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetProviderGuardianForTests();
});

describe("provider guardian", () => {
  it("keeps the configured order while every free route is unknown", () => {
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free,model-c:free");
    expect(guardianChain()).toEqual([
      "model-a:free",
      "model-b:free",
      "model-c:free",
    ]);
    expect(activeRoute()).toBe("model-a:free");
  });

  it("moves a rate-limited route to the end of the chain and keeps it cooling", () => {
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free");
    reportProviderOutcome("model-a:free", "limit", "Kontingent 429");

    expect(guardianChain()).toEqual(["model-b:free", "model-a:free"]);
    expect(activeRoute()).toBe("model-b:free");

    const snapshot = getGuardianSnapshot();
    const cooling = snapshot.routes.find(r => r.model === "model-a:free");
    expect(cooling?.status).toBe("cooling");
    expect(cooling?.cooling).toBe(true);
    expect(cooling?.cooldownUntil).toBeTruthy();
  });

  it("prefers a proven healthy route over an unproven one", () => {
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free");
    reportProviderOutcome("model-b:free", "ok");

    expect(guardianChain()).toEqual(["model-b:free", "model-a:free"]);
    expect(activeRoute()).toBe("model-b:free");
  });

  it("never drops a route from the chain, so hard limits stay visible", () => {
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free");
    reportProviderOutcome("model-a:free", "limit");
    reportProviderOutcome("model-b:free", "limit");
    reportProviderOutcome("model-b:free", "limit");

    expect(guardianChain()).toHaveLength(2);
    expect(getGuardianSnapshot().routes.every(r => r.failures > 0)).toBe(true);
  });

  it("treats a rejected request as a healthy route, not a broken one", () => {
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free");
    reportProviderOutcome("model-a:free", "rejected", "HTTP 400");

    const route = getGuardianSnapshot().routes[0];
    expect(route.status).not.toBe("cooling");
    expect(route.cooling).toBe(false);
    expect(guardianChain()).toEqual(["model-a:free"]);
  });

  it("probes every configured free route and reports a real active model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(catalogOk)
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(chatOk("model-b:free"));

    const result = await runGuardianCycle({ fetcher });

    expect(result.catalogReachable).toBe(true);
    expect(result.activeModel).toBe("model-b:free");
    expect(result.cooling).toContain("model-a:free");
    expect(result.healthy).toContain("model-b:free");

    const snapshot = getGuardianSnapshot();
    expect(snapshot.runCount).toBe(1);
    expect(snapshot.lastError).toBeNull();
  });

  it("fails closed without a key instead of pretending the routes work", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free");
    const fetcher = vi.fn<typeof fetch>();

    const result = await runGuardianCycle({ fetcher });

    expect(result.skippedReason).toBe("MISSING_KEY");
    expect(result.activeModel).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(getGuardianSnapshot().lastError).toMatch(/Schlüssel/);
  });

  it("falls back to the raw configured chain when disabled", () => {
    vi.stubEnv("OPENROUTER_MODELS", "model-a:free,model-b:free");
    reportProviderOutcome("model-a:free", "limit");
    expect(guardianChain()[0]).toBe("model-b:free");

    setGuardianEnabled(false);
    expect(guardianChain()).toEqual(["model-a:free", "model-b:free"]);
  });

  it("exposes the optional Hugging Face fallback without activating it", () => {
    vi.stubEnv("HF_TOKEN", "");
    const snapshot = getGuardianSnapshot();
    expect(snapshot.fallback.provider).toBe("huggingface");
    expect(snapshot.fallback.configured).toBe(false);
    expect(snapshot.note).toMatch(/keine unbegrenzten Token/);
  });
});
