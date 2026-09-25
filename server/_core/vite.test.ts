import { describe, expect, it } from "vitest";
import { resolveViteDevConfig } from "./vite";

describe("resolveViteDevConfig", () => {
  it("resolves the config fn to a real UserConfig with client root, alias and plugins", async () => {
    const config = (await resolveViteDevConfig()) as {
      root?: string;
      resolve?: { alias?: Record<string, string> };
      plugins?: unknown[];
    };

    // Regression: setupVite previously spread the config FUNCTION, so root,
    // aliases and plugins were silently dropped and /src/* fell through
    // to the SPA fallback.
    expect(config.root).toMatch(/[/\\]client$/);
    expect(config.resolve?.alias?.["@"]).toMatch(/[/\\]client[/\\]src$/);
    expect(Array.isArray(config.plugins)).toBe(true);
    expect(config.plugins?.length).toBeGreaterThan(0);
  });
});
