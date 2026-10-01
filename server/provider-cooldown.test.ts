import { afterEach, describe, expect, it } from "vitest";
import {
  clearProviderCooldownsForTests,
  markProviderFailure,
  providerCooldownUntil,
  providerInCooldown,
} from "./provider-cooldown";

afterEach(() => {
  clearProviderCooldownsForTests();
});

describe("Cooldown-Mechanismus (Sprint 034)", () => {
  it("sperrt fehlerhafte Anbieter zeitlich begrenzt — Standard je Fehlerart", () => {
    const until = markProviderFailure("groq", "auth");
    const now = Date.now();
    expect(until - now).toBeGreaterThanOrEqual(29 * 60 * 1000);
    expect(providerInCooldown("groq")).toBe(true);
    expect(providerInCooldown("gemini")).toBe(false);
    expect(providerCooldownUntil("groq")).toBe(until);

    const limitUntil = markProviderFailure("gemini", "limit");
    expect(limitUntil - now).toBeLessThanOrEqual(5 * 60 * 1000 + 100);
  });

  it("nutzt dokumentiertes Retry-After statt zu raten", () => {
    const now = Date.now();
    const until = markProviderFailure("groq", "limit", 42);
    expect(until - now).toBeLessThanOrEqual(42 * 1000);
    expect(providerInCooldown("groq", now + 41 * 1000)).toBe(true);
    expect(providerInCooldown("groq", now + 43 * 1000)).toBe(false);
  });

  it("begrenzt Retry-After auf 60 Minuten und sperrt bei 0 nicht", () => {
    const now = Date.now();
    const until = markProviderFailure("groq", "limit", 24 * 3600);
    expect(until - now).toBeLessThanOrEqual(60 * 60 * 1000);

    markProviderFailure("gemini", "limit", 0);
    expect(providerInCooldown("gemini")).toBe(false);
  });

  it("verkuerzt eine bestehende laengere Sperre nie", () => {
    const longUntil = markProviderFailure("groq", "limit", 3600);
    const shortUntil = markProviderFailure("groq", "limit", 10);
    expect(shortUntil).toBe(longUntil);
  });
});
