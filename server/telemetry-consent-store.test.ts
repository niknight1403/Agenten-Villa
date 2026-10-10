/**
 * Sprint 098 — Konservative Fallbacks des Consent-Stores:
 * Ohne Datenbank gilt immer "nicht eingewilligt".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn(async () => null) }));

import { getTelemetryConsent, setTelemetryConsent, TELEMETRY_PRIVACY_NOTICE } from "./telemetry-consent";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("telemetry-consent Store (Sprint 098)", () => {
  it("ohne Datenbank gilt konservativ: nicht eingewilligt", async () => {
    const state = await getTelemetryConsent(42);
    expect(state.optedIn).toBe(false);
    expect(state.notice).toBe(TELEMETRY_PRIVACY_NOTICE);
  });

  it("der Datenschutz-Hinweis nennt die harten Grenzen ehrlich", () => {
    expect(TELEMETRY_PRIVACY_NOTICE).toContain("Nie erhoben werden");
    expect(TELEMETRY_PRIVACY_NOTICE).toContain("kein Export");
    expect(TELEMETRY_PRIVACY_NOTICE).toContain("jederzeit abschaltbar");
  });

  it("setTelemetryConsent ohne Datenbank wirft (Speichern bleibt ehrlich)", async () => {
    await expect(setTelemetryConsent(42, true)).rejects.toThrow(
      "DATABASE_UNAVAILABLE"
    );
  });
});
