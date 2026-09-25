import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationStatus, logStartupDiagnostics } from "./_core/diagnostics";

const baseEnv = {};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("startup diagnostics", () => {
  it("meldet leere Umgebung vollstaendig als nicht konfiguriert", () => {
    const rows = integrationStatus({ ...baseEnv });
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows) {
      if (!row.name.includes("optional")) {
        expect(row.configured).toBe(false);
      }
    }
  });

  it("erkennt gesetzte Variablen einzeln", () => {
    const rows = integrationStatus({ DATABASE_URL: "mysql://...", ...baseEnv });
    expect(
      rows.find(r => r.name.includes("DATABASE_URL"))?.configured
    ).toBe(true);
    expect(
      rows.find(r => r.name.includes("OPENROUTER_API_KEY"))?.configured
    ).toBe(false);
  });

  it("druckt keine Werte, nur Namen und Status", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logStartupDiagnostics();
    const joined = log.mock.calls.map(String).join("\n");
    expect(joined).toContain("Integrationen");
    expect(joined).not.toContain("mysql://");
    expect(joined).not.toContain("sk-");
  });
});
