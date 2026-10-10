import { describe, expect, it } from "vitest";
import {
  normalizeRepositoryInput,
  onboardingSteps,
  validateNewVillaForm,
} from "./villa-onboarding";

describe("Repository-Normalisierung (Sprint 097)", () => {
  it("verzeiht eingeklebte GitHub-URLs und .git-Suffixe", () => {
    expect(normalizeRepositoryInput("niknight1403/Agenten-Villa")).toBe(
      "niknight1403/Agenten-Villa"
    );
    expect(
      normalizeRepositoryInput("https://github.com/niknight1403/Agenten-Villa")
    ).toBe("niknight1403/Agenten-Villa");
    expect(
      normalizeRepositoryInput("http://www.github.com/foo/bar.git")
    ).toBe("foo/bar");
    expect(normalizeRepositoryInput("github.com/foo/bar/")).toBe("foo/bar");
    expect(normalizeRepositoryInput("  owner/repo.git  ")).toBe("owner/repo");
  });

  it("lehnt ungueltige Eingaben ehrlich ab", () => {
    expect(normalizeRepositoryInput("https://gitlab.com/foo/bar")).toBeNull();
    expect(normalizeRepositoryInput("nur-ein-name")).toBeNull();
    expect(normalizeRepositoryInput("a//b")).toBeNull();
    expect(normalizeRepositoryInput("")).toBeNull();
    expect(normalizeRepositoryInput("/foo/bar")).toBeNull();
  });
});

describe("Formular-Validierung (Sprint 097)", () => {
  const base = { name: "Marketing-Villa", repository: "", projectBrief: "", description: "" };

  it("akzeptiert ein Minimalformular (nur Name)", () => {
    const result = validateNewVillaForm(base);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("normalisiert ein gueltiges Repository beim Pruefen", () => {
    const result = validateNewVillaForm({
      ...base,
      repository: "https://github.com/foo/bar.git",
    });
    expect(result.ok).toBe(true);
    expect(result.normalizedRepository).toBe("foo/bar");
  });

  it("blockiert mit klaren Meldungen statt Server-Zod-Fehlern", () => {
    const result = validateNewVillaForm({
      ...base,
      name: "",
      repository: "https://gitlab.com/foo/bar",
      projectBrief: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toContain("Namen");
    expect(result.errors.repository).toContain("owner/repo");
    expect(result.errors.projectBrief).toContain("3 Zeichen");
  });

  it("erkennt zu lange Namen und Beschreibungen", () => {
    const result = validateNewVillaForm({
      ...base,
      name: "x".repeat(81),
      description: "y".repeat(1001),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toContain("80");
    expect(result.errors.description).toContain("1000");
  });
});

describe("Onboarding-Schritte (Sprint 097)", () => {
  it("frische Villa ohne Ziel und Repository bekommt konkrete Schritte", () => {
    const steps = onboardingSteps({ name: "Neu", repository: null, projectBrief: null });
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.some((step) => step.includes("Projektziel"))).toBe(true);
    expect(steps.some((step) => step.includes("Server-Standard-Repository"))).toBe(true);
  });

  it("vollstaendige Villa verweist auf Analyse/Mission statt Sackgasse", () => {
    const steps = onboardingSteps({
      name: "Fertig",
      repository: "foo/bar",
      projectBrief: "Ziel",
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain("Analyse");
  });
});
