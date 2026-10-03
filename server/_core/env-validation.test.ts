import { describe, expect, it } from "vitest";
import { validateProductionEnv } from "./env-validation";

const COMPLETE_ENV = {
  DATABASE_URL: "postgres://user:pass@host/db",
  GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "secret",
};

describe("Produktions-Env-Validierung (Sprint 076)", () => {
  it("erlaubt den Start bei vollstaendiger Pflichtkonfiguration", () => {
    const report = validateProductionEnv(COMPLETE_ENV, "production");
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.message).toBe("");
  });

  it("bricht bei fehlender DATABASE_URL sofort mit klarem Hinweis ab", () => {
    const report = validateProductionEnv(
      { ...COMPLETE_ENV, DATABASE_URL: " " },
      "production"
    );
    expect(report.ok).toBe(false);
    expect(report.issues.map(issue => issue.name)).toContain("DATABASE_URL");
    expect(report.message).toContain("DATABASE_URL");
    expect(report.message).toContain("PostgreSQL");
    expect(report.message).toContain("Start abgebrochen");
  });

  it("listet ALLE fehlenden Pflichtvariablen auf einmal auf", () => {
    const report = validateProductionEnv({}, "production");
    expect(report.ok).toBe(false);
    expect(report.issues).toHaveLength(3);
    for (const name of [
      "DATABASE_URL",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ]) {
      expect(report.issues.map(issue => issue.name)).toContain(name);
      expect(report.message).toContain(name);
    }
  });

  it("bleibt ausserhalb der Produktion bewusst tolerant", () => {
    expect(validateProductionEnv({}, "development").ok).toBe(true);
    expect(validateProductionEnv({}, undefined).ok).toBe(true);
  });

  it("laesst optionale LLM-Schluessel ausser Acht (Multi-Provider-Kette)", () => {
    const report = validateProductionEnv(COMPLETE_ENV, "production");
    expect(report.issues.map(issue => issue.name)).not.toContain(
      "OPENROUTER_API_KEY"
    );
    expect(report.ok).toBe(true);
  });
});
