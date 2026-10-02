/**
 * Sprint 057 — Export-Schutz-Regression.
 *
 * Invarianten:
 *  - Der Export enthaelt NUR die Whitelist des versionierten Schemas —
 *    interne Felder (Datenbank-IDs, createdBy, E-Mails, Provider-/Modell-
 *    Metadaten) koennen den Server nicht verlassen.
 *  - Unzulaessige Rollen und leere Inhalte werden vor der Freigabe gefiltert.
 *  - Die Export-Version ist fixiert (1) — ein manipuliertes raw-Objekt kann
 *    sie nicht umschreiben.
 *  - Grenzwerte (Kapazitaet, Nachrichtenlaenge) werden erzwungen.
 */
import { describe, expect, it } from "vitest";
import {
  sanitizeVillaExport,
  villaExportSchema,
  VILLA_EXPORT_VERSION,
} from "./villa-export";

function rawExport(overrides: Record<string, unknown> = {}) {
  return {
    name: "Villa Alpha",
    specialty: "Code-Analyse",
    icon: "bot" as const,
    projectBrief: null,
    description: null,
    capacity: 8,
    messages: [
      { role: "user", content: "Frage", createdAt: new Date() },
      { role: "assistant", content: "Antwort", createdAt: new Date() },
    ],
    exportedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

describe("sanitizeVillaExport", () => {
  it("entfernt interne Felder aus dem Export (Whitelist)", () => {
    const raw = rawExport({
      id: 3,
      villaId: 3,
      createdBy: 17,
      email: "user@example.com",
      messages: [
        {
          id: 11,
          villaId: 3,
          role: "user",
          content: "Frage",
          provider: "openrouter/free",
          model: "free-test",
          rating: 5,
          createdAt: new Date(),
        },
      ],
    });
    const result = sanitizeVillaExport(raw as never);
    expect(Object.keys(result).sort()).toEqual(
      [
        "capacity",
        "description",
        "exportedAt",
        "icon",
        "messages",
        "name",
        "projectBrief",
        "specialty",
        "version",
      ].sort()
    );
    expect((result as Record<string, unknown>).id).toBeUndefined();
    expect((result as Record<string, unknown>).createdBy).toBeUndefined();
    expect((result as Record<string, unknown>).email).toBeUndefined();
    expect(result.messages[0]).not.toHaveProperty("provider");
    expect(result.messages[0]).not.toHaveProperty("model");
    expect(result.messages[0]).not.toHaveProperty("rating");
    expect(result.messages[0]).not.toHaveProperty("id");
  });

  it("filtert unzulaessige Rollen (z. B. system) heraus", () => {
    const raw = rawExport({
      messages: [
        { role: "system", content: "intern", createdAt: new Date() },
        { role: "user", content: "Frage", createdAt: new Date() },
        { role: "assistant", content: "Antwort", createdAt: new Date() },
      ],
    });
    const result = sanitizeVillaExport(raw as never);
    expect(result.messages.map(m => m.role)).toEqual(["user", "assistant"]);
  });

  it("filtert leere Nachrichteninhalte heraus", () => {
    const raw = rawExport({
      messages: [
        { role: "user", content: "", createdAt: new Date() },
        { role: "user", content: "gueltig", createdAt: new Date() },
      ],
    });
    const result = sanitizeVillaExport(raw as never);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("gueltig");
  });

  it("pinnt die Export-Version auf die aktuelle Version", () => {
    const raw = rawExport({ version: 999 });
    const result = sanitizeVillaExport(raw as never);
    expect(result.version).toBe(VILLA_EXPORT_VERSION);
    expect(result.version).toBe(1);
  });

  it("erzwingt Kapazitaets- und Namensgrenzen", () => {
    expect(() => sanitizeVillaExport(rawExport({ capacity: 26 }) as never)).toThrow();
    expect(() => sanitizeVillaExport(rawExport({ capacity: 0 }) as never)).toThrow();
    expect(() => sanitizeVillaExport(rawExport({ name: "" }) as never)).toThrow();
  });

  it("laesst einen wohlgeformten Export unveraendert durch", () => {
    const raw = rawExport();
    const result = sanitizeVillaExport(raw);
    expect(result.name).toBe("Villa Alpha");
    expect(result.messages).toHaveLength(2);
    expect(villaExportSchema.parse(result)).toEqual(result);
  });
});
