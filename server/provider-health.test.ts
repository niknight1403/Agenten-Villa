import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_HEALTH_TIMEOUT_MS,
  checkProviderHealth,
  resetProviderHealthForTests,
} from "./provider-health";

const ok = () => new Response("{}", { status: 200 });

describe("Provider-Gesundheitscheck (Sprint 036)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("HF_TOKEN", "hf-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetProviderHealthForTests();
  });

  it("prüft harmlos: ein GET ohne Körper auf einen Status-Endpunkt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok());
    const result = await checkProviderHealth("openrouter", { fetcher });
    expect(result).toMatchObject({ status: "valid", cached: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/key");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect((init?.signal as AbortSignal).aborted).toBe(false);
  });

  it("klassifiziert 401/403 als invalid und alles andere als unavailable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    const fresh = { fetcher, minIntervalMs: 0 };
    expect(await checkProviderHealth("groq", fresh)).toMatchObject({
      status: "invalid",
    });
    expect(await checkProviderHealth("groq", fresh)).toMatchObject({
      status: "unavailable",
    });
  });

  it("nutzt je Anbieter den richtigen Endpunkt und Schlüsselheader", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok());
    await checkProviderHealth("groq", { fetcher });
    await checkProviderHealth("gemini", { fetcher });
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.groq.com/openai/v1/models"
    );
    expect(
      (fetcher.mock.calls[0][1] as RequestInit).headers
    ).toMatchObject({ Authorization: "Bearer groq-key" });
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models"
    );
    expect(
      (fetcher.mock.calls[1][1] as RequestInit).headers
    ).toMatchObject({ "x-goog-api-key": "gemini-key" });
  });

  it("sendet ohne konfigurierten Schlüssel gar keine Anfrage", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const fetcher = vi.fn<typeof fetch>();
    expect(await checkProviderHealth("groq", { fetcher })).toMatchObject({
      status: "not_configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bleibt einwilligungsgated: Hugging Face nur mit ausdrücklichem Consent", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok());
    expect(await checkProviderHealth("huggingface", { fetcher })).toMatchObject({
      status: "consent_required",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await checkProviderHealth("huggingface", {
        fetcher,
        consentHuggingFace: true,
        minIntervalMs: 0,
      })
    ).toMatchObject({ status: "valid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("begrenzt Anfragen: im Mindestabstand wird das letzte Ergebnis gelesen", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok());
    let clock = 1_000_000;
    const options = {
      fetcher,
      minIntervalMs: 10_000,
      now: () => clock,
    };
    const first = await checkProviderHealth("openrouter", options);
    expect(first.cached).toBe(false);
    const second = await checkProviderHealth("openrouter", options);
    expect(second).toMatchObject({ status: "valid", cached: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Nach Ablauf des Mindestabstands wird erneut gefragt
    clock += 10_001;
    const third = await checkProviderHealth("openrouter", options);
    expect(third.cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("trägt das harte Zeitlimit in jeder Anfrage", () => {
    expect(PROVIDER_HEALTH_TIMEOUT_MS).toBe(8_000);
  });
});
