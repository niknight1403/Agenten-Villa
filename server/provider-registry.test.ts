import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  getProviderCatalogEntry,
  isProviderActive,
  listProviderCatalog,
} from "./provider-registry";

function createContext(userId = 17): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: userId,
      openId: "test-open-id",
      email: "user@example.com",
      name: "Test User",
      loginMethod: "test",
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => {
  delete process.env.PROVIDER_STATUS_GROQ;
  delete process.env.PROVIDER_STATUS_OPENROUTER;
  delete process.env.PROVIDER_STATUS_GEMINI;
  delete process.env.PROVIDER_STATUS_HUGGINGFACE;
  vi.restoreAllMocks();
});

describe("Providerregister (Sprint 031)", () => {
  it("documents every provider with capabilities and a status field", () => {
    const catalog = listProviderCatalog();
    expect(catalog.map(entry => entry.name)).toEqual([
      "openrouter",
      "groq",
      "gemini",
      "huggingface",
    ]);
    for (const entry of catalog) {
      expect(entry.status).toBe("active");
      expect(entry.capabilities).toContain("chat");
      expect(entry.capabilities).toContain("tools");
      expect(entry.models().length).toBeGreaterThan(0);
      expect(entry.chatUrl()).toMatch(/^https:\/\//);
      expect(entry.docsUrl).toMatch(/^https:\/\//);
    }
    expect(
      catalog.find(entry => entry.name === "huggingface")?.consentRequired
    ).toBe(true);
    expect(
      catalog.find(entry => entry.name === "openrouter")?.consentRequired
    ).toBe(false);
  });

  it("honours status overrides and rejects invalid values", () => {
    process.env.PROVIDER_STATUS_GROQ = "maintenance";
    expect(getProviderCatalogEntry("groq")?.status).toBe("maintenance");
    expect(isProviderActive("groq")).toBe(false);
    expect(isProviderActive("gemini")).toBe(true);

    process.env.PROVIDER_STATUS_GROQ = "kaputt";
    expect(getProviderCatalogEntry("groq")?.status).toBe("active");

    process.env.PROVIDER_STATUS_GROQ = "retired";
    expect(getProviderCatalogEntry("groq")?.status).toBe("retired");
    expect(isProviderActive("groq")).toBe(false);
  });

  it("returns undefined for unknown providers", () => {
    expect(getProviderCatalogEntry("nichtda")).toBeUndefined();
  });

  it("exposes the registry read-only to authenticated users", async () => {
    process.env.PROVIDER_STATUS_GEMINI = "maintenance";
    const caller = appRouter.createCaller(createContext());
    const providers = await caller.agent.providers();
    expect(providers).toHaveLength(4);
    expect(providers.find(p => p.name === "gemini")).toMatchObject({
      status: "maintenance",
    });
    expect(providers.find(p => p.name === "huggingface")).toMatchObject({
      consentRequired: true,
    });
  });
});
