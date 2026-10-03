import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  DOCUMENTED_FALLBACK_ORDER,
  fallbackOrder,
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
  delete process.env.PROVIDER_FALLBACK_ORDER;
  vi.restoreAllMocks();
});

describe("Providerregister (Sprint 031)", () => {
  it("documents every provider with capabilities and a status field", () => {
    const catalog = listProviderCatalog();
    expect(catalog.map(entry => entry.name)).toEqual([
      "ollama",
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
      // Sprint 080 — Ollama ist optional konfiguriert (http lokal erlaubt);
      // die Cloud-Anbieter bleiben https-pflichtig.
      expect(entry.chatUrl()).toMatch(
        entry.name === "ollama" ? /^(https?:\/\/|$)/ : /^https:\/\//
      );
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
    const registry = await caller.agent.providers();
    expect(registry.entries).toHaveLength(5);
    expect(registry.entries.find(p => p.name === "gemini")).toMatchObject({
      status: "maintenance",
    });
    expect(registry.entries.find(p => p.name === "huggingface")).toMatchObject({
      consentRequired: true,
    });
  });
});

describe("Fallback-Reihenfolge (Sprint 032)", () => {
  it("uses the documented order without configuration", () => {
    expect(fallbackOrder()).toEqual([...DOCUMENTED_FALLBACK_ORDER]);
  });

  it("honours a configured order deterministically and keeps the rest", () => {
    process.env.PROVIDER_FALLBACK_ORDER = "gemini,openrouter";
    expect(fallbackOrder()).toEqual([
      "gemini",
      "openrouter",
      "ollama",
      "groq",
      "huggingface",
    ]);
  });

  it("drops unknown names and duplicates instead of failing open", () => {
    process.env.PROVIDER_FALLBACK_ORDER = "phantasie, gemini ,GEMINI";
    // gemini ist gueltig (einmal, dedupliziert), die Ungueltigen fallen weg
    expect(fallbackOrder()).toEqual([
      "gemini",
      "ollama",
      "openrouter",
      "groq",
      "huggingface",
    ]);
    // nur ungueltige Namen => dokumentierte Reihenfolge bleibt verbindlich
    process.env.PROVIDER_FALLBACK_ORDER = "phantasie,oss";
    expect(fallbackOrder()).toEqual([...DOCUMENTED_FALLBACK_ORDER]);
  });

  it("exposes the effective order read-only via the providers query", async () => {
    process.env.PROVIDER_FALLBACK_ORDER = "groq";
    const caller = appRouter.createCaller(createContext());
    const registry = await caller.agent.providers();
    expect(registry.fallbackOrder).toEqual([
      "groq",
      "ollama",
      "openrouter",
      "gemini",
      "huggingface",
    ]);
    expect(registry.entries).toHaveLength(5);
  });
});
