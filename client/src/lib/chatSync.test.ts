/**
 * Sprint 067 — Regression: Synchronisationskonflikte.
 *
 * Invarianten:
 *  - Ein gescheiterter Sendungsweg bleibt sichtbar und wiederholbar; der
 *    Text der Nutzer-Nachricht geht nie verloren.
 *  - „Erneut senden“ entfernt genau den gescheiterten Zug an seiner
 *    Position (Nachricht + Folgefehlerantworten), nie ältere oder andere.
 *  - Nur-lokal-Züge bleiben lesbar, tragen aber einen Warnhinweis.
 *  - Abgeschlossene Nachrichten tragen nie einen Konflikt-Hinweis.
 */
import { describe, expect, it } from "vitest";
import {
  findFailedUserIndex,
  markLastUserMessageFailed,
  markTailLocalOnly,
  removeFailedExchangeAt,
  syncNotice,
} from "./chatSync";

/** Realistischer Verlauf vor einem Zug, der gleich scheitert. */
function history() {
  return [
    { role: "user" as const, text: "Erste Frage" },
    { role: "assistant" as const, text: "Erste Antwort" },
  ];
}

/** Realistischer gescheiterter Zug: Nutzer-Nachricht + Fehlerantwort. */
function failedExchange() {
  return [
    { role: "user" as const, text: "Zweite Frage", syncState: "failed" as const },
    { role: "assistant" as const, text: "Keine Verbindung.", syncState: "failed" as const },
  ];
}

describe("markLastUserMessageFailed", () => {
  it("markiert die letzte Nutzer-Nachricht mit diesem Text", () => {
    const messages = markLastUserMessageFailed(history(), "Erste Frage");
    expect(messages[0]).toMatchObject({ role: "user", syncState: "failed" });
    expect(messages[1].syncState).toBeUndefined();
  });

  it("markiert nie eine Nachricht doppelt", () => {
    const once = markLastUserMessageFailed(history(), "Erste Frage");
    const twice = markLastUserMessageFailed(once, "Erste Frage");
    expect(twice).toBe(once);
  });

  it("lässt den Verlauf unverändert, wenn der Text fehlt", () => {
    const messages = history();
    expect(markLastUserMessageFailed(messages, "nicht vorhanden")).toBe(messages);
  });

  it("erkennt mehrere gescheiterte Züge mit gleichem Text einzeln", () => {
    const messages = markLastUserMessageFailed(history(), "Erste Frage");
    const withSecond = [
      ...messages,
      { role: "user", text: "Erste Frage" },
    ];
    const marked = markLastUserMessageFailed(withSecond, "Erste Frage");
    expect(marked.filter(m => m.syncState === "failed")).toHaveLength(2);
  });
});

describe("removeFailedExchangeAt", () => {
  it("entfernt den gescheiterten Zug inklusive Fehlerantwort", () => {
    const messages = [...history(), ...failedExchange()];
    const cleaned = removeFailedExchangeAt(messages, 2);
    expect(cleaned.map(m => m.text)).toEqual(["Erste Frage", "Erste Antwort"]);
  });

  it("entfernt nur die Folgefehler, nicht folgende saubere Nachrichten", () => {
    const messages = [
      ...history(),
      ...failedExchange(),
      { role: "user" as const, text: "Dritte Frage" },
    ];
    const cleaned = removeFailedExchangeAt(messages, 2);
    expect(cleaned.map(m => m.text)).toEqual([
      "Erste Frage",
      "Erste Antwort",
      "Dritte Frage",
    ]);
  });

  it("entfernt nur die markierte Nutzer-Nachricht ohne Fehlerantwort", () => {
    const messages = [
      ...history(),
      { role: "user" as const, text: "Zweite Frage", syncState: "failed" as const },
      { role: "assistant" as const, text: "Saubere Antwort" },
    ];
    const cleaned = removeFailedExchangeAt(messages, 2);
    expect(cleaned.map(m => m.text)).toEqual([
      "Erste Frage",
      "Erste Antwort",
      "Saubere Antwort",
    ]);
  });

  it("lässt andere gescheiterte Züge mit gleichem Text unberührt", () => {
    const messages = [
      ...history(),
      { role: "user" as const, text: "Zweite Frage", syncState: "failed" as const },
      { role: "assistant" as const, text: "Fehler 1", syncState: "failed" as const },
      { role: "user" as const, text: "Zweite Frage", syncState: "failed" as const },
      { role: "assistant" as const, text: "Fehler 2", syncState: "failed" as const },
    ];
    const cleaned = removeFailedExchangeAt(messages, 4);
    expect(findFailedUserIndex(cleaned, "Zweite Frage")).toBe(2);
    expect(cleaned).toHaveLength(4);
  });

  it("ändert nichts bei unpassendem Index oder ohne Konflikt", () => {
    const messages = [...history(), ...failedExchange()];
    expect(removeFailedExchangeAt(messages, 99)).toBe(messages);
    expect(removeFailedExchangeAt(messages, -1)).toBe(messages);
    expect(removeFailedExchangeAt(messages, 0)).toBe(messages); // saubere Nutzer-Nachricht
    expect(removeFailedExchangeAt(messages, 3)).toBe(messages); // Assistent, nicht Nutzer
  });
});

describe("markTailLocalOnly", () => {
  it("markiert die letzten beiden Nachrichten eines Zugs", () => {
    const messages = markTailLocalOnly(
      [
        { role: "user" as const, text: "Frage" },
        { role: "assistant" as const, text: "Antwort" },
      ],
      2
    );
    expect(messages[1].syncState).toBe("local-only");
    expect(messages[0].syncState).toBe("local-only");
  });

  it("begrenzt auf vorhandene Nachrichten und überschreibt „failed“ nie", () => {
    const messages = markTailLocalOnly(
      [{ role: "user", text: "Solo", syncState: "failed" as const }],
      5
    );
    expect(messages[0].syncState).toBe("failed");
  });
});

describe("syncNotice", () => {
  it("erklärt fehlgeschlagene Sendungen wiederholbar", () => {
    expect(syncNotice({ role: "user", text: "Hi", syncState: "failed" })).toBe(
      "Nicht gesendet — du kannst es erneut versuchen."
    );
    expect(syncNotice({ role: "assistant", text: "Fehler", syncState: "failed" })).toContain(
      "wiederholbar"
    );
  });

  it("warnt vor nur-lokalen Zügen", () => {
    expect(
      syncNotice({ role: "assistant", text: "Antwort", syncState: "local-only" })
    ).toContain("beim nächsten Laden nicht mehr verfügbar");
  });

  it("gibt für saubere Nachrichten keinen Hinweis", () => {
    expect(syncNotice({ role: "user", text: "Hi" })).toBeNull();
    expect(syncNotice({ role: "assistant", text: "Antwort" })).toBeNull();
  });
});
