import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PACKS,
  ELITE_PLAN,
  LOGICAL_AGENTS_PER_VILLA,
  getEliteConnectorSnapshot,
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

  it("enables the elite feature, tool, developer, system, skill, and connector packs", () => {
    expect(CAPABILITY_PACKS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CAPABILITY_PACKS.map(pack => pack.kind))).toEqual(
      new Set([
        "feature",
        "tool",
        "developer",
        "system",
        "skill",
        "connector",
      ])
    );
    expect(CAPABILITY_PACKS.every(pack => pack.enabledByDefault)).toBe(true);
    expect(isKnownPack("github-read")).toBe(true);
    expect(isKnownPack("elite-project-factory")).toBe(true);
    expect(isKnownPack("idea-to-product")).toBe(true);
    expect(isKnownPack("limit-bypass")).toBe(false);
  });

  it("activates administrator elite without a local total turn/token quota", () => {
    expect(ELITE_PLAN.enabled).toBe(true);
    expect(ELITE_PLAN.localTurnQuota).toBeNull();
    expect(ELITE_PLAN.localTokenQuota).toBeNull();
    expect(ELITE_PLAN.autonomousProjectMissions).toBe(true);
    const snapshot = getVillaSnapshot();
    expect(snapshot.edition).toBe("Administrator Elite");
    expect(snapshot.autonomy.ideaToProject).toBe(true);
    expect(snapshot.policy.administratorLocalTurnQuota).toBeNull();
    expect(snapshot.policy.administratorLocalTokenQuota).toBeNull();
  });

  it("reports configured connector readiness without exposing secret values", () => {
    const serialized = JSON.stringify(getEliteConnectorSnapshot());
    expect(serialized).toContain("openrouter");
    expect(serialized).toContain("github");
    expect(serialized).toContain("postgres");
    expect(serialized).not.toContain("GITHUB_TOKEN");
    expect(serialized).not.toContain("OPENROUTER_API_KEY");
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
    expect(policy.defaultBranchProtectedFromAgentWrites).toBe(true);
    expect(policy.draftReviewBeforeMerge).toBe(true);
  });
});
