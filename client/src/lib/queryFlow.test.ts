/**
 * Sprint 069 — Fehler- und Ladezustände (Roadmap 068).
 *
 * Invarianten:
 *  - Deaktivierte Abfragen (z. B. vor der Anmeldung) sind „ready“ —
 *    kein Endlos-Spinner für Inhalte, die bewusst nicht geladen werden.
 *  - Fehler schlagen Laden ab: „error“ gewinnt über „loading“.
 *  - Erstladen mit laufendem Fetch = „loading“; hängendes „pending“
 *    ohne Fetch bleibt „ready“ (kein blockierter Zustand).
 *  - Fehlertexte sind nie leer; leere Listen bekommen einen Hinweis.
 */
import { describe, expect, it } from "vitest";
import { emptyFallback, flowErrorMessage, flowPhase } from "./queryFlow";

describe("flowPhase", () => {
  it("ist ready, wenn die Abfrage deaktiviert ist (kein Spinner vor Login)", () => {
    expect(
      flowPhase({ enabled: false, isPending: true, isFetching: false, isError: false })
    ).toBe("ready");
  });

  it("ist loading beim ersten Laden mit laufendem Fetch", () => {
    expect(
      flowPhase({ enabled: true, isPending: true, isFetching: true, isError: false })
    ).toBe("loading");
  });

  it("bleibt ready bei hängendem pending ohne Fetch (kein blockierter Zustand)", () => {
    expect(
      flowPhase({ enabled: true, isPending: true, isFetching: false, isError: false })
    ).toBe("ready");
  });

  it("ist ready mit geladenen Daten", () => {
    expect(
      flowPhase({ enabled: true, isPending: false, isFetching: false, isError: false })
    ).toBe("ready");
  });

  it("lässt Fehler gegen alles andere gewinnen", () => {
    expect(
      flowPhase({ enabled: true, isPending: true, isFetching: true, isError: true })
    ).toBe("error");
  });
});

describe("flowErrorMessage", () => {
  it("nutzt die Fehlernachricht von Error-Objekten", () => {
    expect(flowErrorMessage(new Error("Datenbank nicht erreichbar"))).toBe(
      "Datenbank nicht erreichbar"
    );
  });

  it("greift auf lesbaren Standardtext zurück", () => {
    expect(flowErrorMessage(undefined)).toBe(
      "Die Daten konnten nicht geladen werden."
    );
    expect(flowErrorMessage("irgendwas")).toBe(
      "Die Daten konnten nicht geladen werden."
    );
    expect(flowErrorMessage(new Error("   "))).toBe(
      "Die Daten konnten nicht geladen werden."
    );
  });
});

describe("emptyFallback", () => {
  it("erklärt leere Listen im ready-Zustand", () => {
    expect(emptyFallback("ready", true)).toBe("Keine Einträge.");
  });

  it("schweigt, wenn Inhalte existieren oder ein anderer Zustand herrscht", () => {
    expect(emptyFallback("ready", false)).toBeNull();
    expect(emptyFallback("loading", true)).toBeNull();
    expect(emptyFallback("error", true)).toBeNull();
  });
});
