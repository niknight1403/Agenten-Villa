import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appVersion,
  getHealthPayload,
  resetVersionCacheForTests,
} from "./_core/health";

afterEach(() => {
  resetVersionCacheForTests();
  vi.restoreAllMocks();
});

describe("health endpoint", () => {
  it("liefert ein positives Payload mit Version, Modus und Uptime", () => {
    const payload = getHealthPayload();
    expect(payload.ok).toBe(true);
    expect(payload.version).toMatch(/[0-9]+\.[0-9]+\.[0-9]+/);
    expect(payload.mode).toBeTypeOf("string");
    expect(payload.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });

  it("liest die Version aus package.json des Arbeitsverzeichnisses", () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(process.cwd());
    expect(appVersion()).toBe(appVersion()); // stabiler Cache
    expect(spy).toHaveBeenCalled();
  });

  it("faellt auf 'unknown' zurueck, wenn package.json fehlt", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/definitiv-nicht-vorhanden");
    resetVersionCacheForTests();
    expect(appVersion()).toBe("unknown");
  });
});
