import { describe, it, expect } from "vitest";
import {
  VILLA_TEMPLATES,
  findTemplate,
  validateTemplate,
  templateToVillaInput,
  MIN_CAPACITY,
  MAX_CAPACITY,
  type VillaTemplate,
} from "./templates";

describe("Sprint 091 — Projektvorlagen", () => {
  describe("VILLA_TEMPLATES", () => {
    it("enthält mindestens 3 Vorlagen", () => {
      expect(VILLA_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    });

    it("jede Vorlage hat eine eindeutige ID", () => {
      const ids = VILLA_TEMPLATES.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("jede Vorlage hat gültige Kapazität (1–25)", () => {
      for (const t of VILLA_TEMPLATES) {
        expect(t.capacity).toBeGreaterThanOrEqual(MIN_CAPACITY);
        expect(t.capacity).toBeLessThanOrEqual(MAX_CAPACITY);
        expect(Number.isInteger(t.capacity)).toBe(true);
      }
    });

    it("jede Vorlage hat gültiges Icon", () => {
      for (const t of VILLA_TEMPLATES) {
        expect(["villa", "bot"]).toContain(t.icon);
      }
    });

    it("keine Vorlage enthält limit-bypass-Begriffe", () => {
      const suspicious = /limit[-_]?bypass|unlimited|quota[-_]?bypass/i;
      for (const t of VILLA_TEMPLATES) {
        expect(suspicious.test(t.id)).toBe(false);
        expect(suspicious.test(t.name)).toBe(false);
        expect(suspicious.test(t.description)).toBe(false);
        expect(suspicious.test(t.villaName)).toBe(false);
        expect(suspicious.test(t.projectBrief)).toBe(false);
      }
    });
  });

  describe("validateTemplate", () => {
    it("akzeptiert eine gültige Vorlage", () => {
      const valid: VillaTemplate = {
        id: "test-valid",
        name: "Test",
        description: "Test-Vorlage",
        villaName: "Test-Villa",
        specialty: "Tester",
        icon: "villa",
        capacity: 5,
        projectBrief: "Test-Brief",
      };
      expect(() => validateTemplate(valid)).not.toThrow();
    });

    it("lehnt ungültige Kapazität ab", () => {
      const invalid: VillaTemplate = {
        id: "test-cap",
        name: "Test",
        description: "Test",
        villaName: "Test",
        specialty: "Test",
        icon: "villa",
        capacity: 0,
        projectBrief: "Test",
      };
      expect(() => validateTemplate(invalid)).toThrow();
    });

    it("lehnt Kapazität über 25 ab", () => {
      const invalid: VillaTemplate = {
        id: "test-cap-high",
        name: "Test",
        description: "Test",
        villaName: "Test",
        specialty: "Test",
        icon: "villa",
        capacity: 26,
        projectBrief: "Test",
      };
      expect(() => validateTemplate(invalid)).toThrow();
    });

    it("lehnt limit-bypass in ID ab", () => {
      const suspicious: VillaTemplate = {
        id: "limit-bypass",
        name: "Test",
        description: "Test",
        villaName: "Test",
        specialty: "Test",
        icon: "villa",
        capacity: 5,
        projectBrief: "Test",
      };
      expect(() => validateTemplate(suspicious)).toThrow(/verdächtige Begriffe/);
    });

    it("lehnt ungültiges Icon ab", () => {
      const invalid: VillaTemplate = {
        id: "test-icon",
        name: "Test",
        description: "Test",
        villaName: "Test",
        specialty: "Test",
        icon: "invalid" as "villa",
        capacity: 5,
        projectBrief: "Test",
      };
      expect(() => validateTemplate(invalid)).toThrow();
    });
  });

  describe("findTemplate", () => {
    it("findet eine existierende Vorlage", () => {
      const first = VILLA_TEMPLATES[0];
      const found = findTemplate(first.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(first.id);
    });

    it("gibt undefined für unbekannte ID", () => {
      expect(findTemplate("nonexistent-template-id")).toBeUndefined();
    });
  });

  describe("templateToVillaInput", () => {
    it("erzeugt gültige createVilla-Eingabe", () => {
      const first = VILLA_TEMPLATES[0];
      const input = templateToVillaInput(first.id);
      expect(input.name).toBe(first.villaName);
      expect(input.specialty).toBe(first.specialty);
      expect(input.icon).toBe(first.icon);
      expect(input.capacity).toBe(first.capacity);
      expect(input.projectBrief).toBe(first.projectBrief);
      expect(input.repository).toBeNull();
    });

    it("wirft bei unbekannter Vorlage", () => {
      expect(() => templateToVillaInput("nonexistent")).toThrow(/Unbekannte Vorlage/);
    });

    it("alle Vorlagen erzeugen gültige Eingaben", () => {
      for (const t of VILLA_TEMPLATES) {
        const input = templateToVillaInput(t.id);
        expect(input.name).toBeTruthy();
        expect(input.specialty).toBeTruthy();
        expect(input.capacity).toBeGreaterThanOrEqual(MIN_CAPACITY);
        expect(input.capacity).toBeLessThanOrEqual(MAX_CAPACITY);
        expect(input.projectBrief).toBeTruthy();
      }
    });
  });
});
