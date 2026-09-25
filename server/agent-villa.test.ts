import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PACKS,
  LOGICAL_AGENTS_PER_VILLA,
  getVillaSnapshot,
  isKnownPack,
  routeProviderForTests,
} from "./agent-villa";

describe("agent villa orchestration", () => {
  it("exposes 5,000 lazy logical agent slots without provisioning model calls", () => {
    const snapshot = getVillaSnapshot("villa-test");
    expect(LOGICAL_AGENTS_PER_VILLA).toBe(5_000);
    expect(snapshot.logicalAgentCapacity).toBe(5_000);
    expect(snapshot.provisioning).toBe("lazy");
    expect(snapshot.activeLogicalAgents).toBe(0);
    expect(snapshot.availableLogicalAgents).toBe(5_000);
  });

  it("enables all declared feature, tool, developer, and system packs", () => {
    expect(CAPABILITY_PACKS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CAPABILITY_PACKS.map(pack => pack.kind))).toEqual(
      new Set(["feature", "tool", "developer", "system"])
    );
    expect(CAPABILITY_PACKS.every(pack => pack.enabledByDefault)).toBe(true);
    expect(isKnownPack("github-read")).toBe(true);
    expect(isKnownPack("limit-bypass")).toBe(false);
  });

  it("selects the configured free primary route", () => {
    expect(
      routeProviderForTests({
        openRouterConfigured: true,
        huggingFaceConfigured: true,
        allowExplicitFallback: true,
      })
    ).toEqual({
      provider: "openrouter",
      model: "openrouter/free",
      reason: "primary-free",
    });
  });

  it("only selects fallback when explicitly allowed and never creates a route without credentials", () => {
    expect(
      routeProviderForTests({
        openRouterConfigured: false,
        huggingFaceConfigured: true,
        allowExplicitFallback: false,
      })
    ).toBeNull();
    expect(
      routeProviderForTests({
        openRouterConfigured: false,
        huggingFaceConfigured: true,
        allowExplicitFallback: true,
      })
    ).toMatchObject({ provider: "huggingface", reason: "explicit-fallback" });
    expect(
      routeProviderForTests({
        openRouterConfigured: false,
        huggingFaceConfigured: false,
        allowExplicitFallback: true,
      })
    ).toBeNull();
  });

  it("publishes a policy that keeps provider limits and external safety guards enabled", () => {
    const policy = getVillaSnapshot().policy;
    expect(policy.providerLimitsRespected).toBe(true);
    expect(policy.noPaidOrRotatingFallback).toBe(true);
    expect(policy.administratorFullProductAccess).toBe(true);
  });
});
