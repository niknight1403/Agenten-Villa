import { describe, expect, it } from "vitest";

describe("configured Hugging Face credential", () => {
  it("authenticates with whoami without invoking inference", async () => {
    const token = process.env.HF_TOKEN?.trim();
    expect(token, "HF_TOKEN must be available to the project test runtime").toBeTruthy();
    const response = await fetch("https://huggingface.co/api/whoami-v2", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status, "Hugging Face rejected the configured token").toBe(200);
    const payload: unknown = await response.json();
    expect(payload).toBeTypeOf("object");
    expect(response.headers.get("content-type")).toContain("application/json");
  }, 15_000);
});
