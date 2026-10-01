import { describe, expect, it } from "vitest";
import {
  AGENT_ERROR_CODES,
  categoryForError,
  publicMessageForError,
} from "./error-codes";

describe("Fehlerklassifikation (Sprint 033)", () => {
  it("kennt TIMEOUT als eigene Code mit Provider-Kategorie", () => {
    expect(AGENT_ERROR_CODES).toContain("TIMEOUT");
    expect(categoryForError("TIMEOUT")).toBe("provider");
    expect(publicMessageForError("TIMEOUT")).toBe(
      "Der Anbieter konnte die Anfrage gerade nicht verarbeiten."
    );
  });

  it("ordnet Rate-Limit-Fehler der Kontingent-Kategorie zu", () => {
    expect(categoryForError("LIMIT")).toBe("quota");
  });
});
