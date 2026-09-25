import { describe, expect, it } from "vitest";

const runLiveCheck = process.env.RUN_LIVE_OPENROUTER_CHECK === "1";

describe("configured OpenRouter credential", () => {
  it.skipIf(!runLiveCheck)("authenticates against the lightweight key-status endpoint without an inference call", async () => {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    expect(key, "OPENROUTER_API_KEY must be available to the project test runtime").toBeTruthy();
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status, "The OpenRouter key-status endpoint rejected the configured key").toBe(200);
    const payload: unknown = await response.json();
    expect(payload).toBeTypeOf("object");
    expect(response.headers.get("content-type")).toContain("application/json");
  }, 15_000);
});
