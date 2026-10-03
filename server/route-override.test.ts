import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRouteOverride,
  getRouteOverride,
  pinnableProviders,
  resetRouteOverrideForTests,
  setRouteOverride,
} from "./route-override";

afterEach(() => {
  resetRouteOverrideForTests();
  vi.unstubAllEnvs();
});

describe("Admin-Pin (Sprint 079)", () => {
  it("setzt und liest einen Pin mit Admin-Herkunft", () => {
    const override = setRouteOverride("groq", "chef@villa.test");
    expect(override).toMatchObject({ provider: "groq", by: "chef@villa.test" });
    expect(getRouteOverride()).toBe(override);
  });

  it("lehnt Anbieter ab, die im Register nicht aktiv sind", () => {
    vi.stubEnv("PROVIDER_STATUS_GROQ", "maintenance");
    expect(setRouteOverride("groq", "chef@villa.test")).toBeNull();
    expect(getRouteOverride()).toBeNull();
  });

  it("hebt den Pin auf und kehrt zur Auto-Kette zurueck", () => {
    setRouteOverride("groq", "chef@villa.test");
    clearRouteOverride();
    expect(getRouteOverride()).toBeNull();
  });

  it("listet die pinnbaren Anbieter deterministisch", () => {
    expect(pinnableProviders()).toEqual([
      "openrouter",
      "groq",
      "gemini",
      "huggingface",
    ]);
  });

  it("ueberschreibt einen alten Pin mit dem neuesten", () => {
    setRouteOverride("groq", "a@villa.test");
    const second = setRouteOverride("gemini", "b@villa.test");
    expect(getRouteOverride()).toBe(second);
    expect(second).toMatchObject({ provider: "gemini", by: "b@villa.test" });
  });
});
