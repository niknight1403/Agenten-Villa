import { describe, expect, it } from "vitest";
import { planFromPrompt, planFromRules, storageStats, storageSuggestions, type StorageEntry } from "./storage-plan";

const files: StorageEntry[] = [
  { id: "photo", name: "Urlaub.jpg", size: 150 * 1024 ** 2, modified: 1, mime: "image/jpeg", directory: false },
  { id: "pdf", name: "Vertrag.pdf", size: 2 * 1024 ** 2, modified: 2, mime: "application/pdf", directory: false },
  { id: "dir", name: "Archiv", size: 0, modified: 3, mime: "", directory: true },
];

describe("local Android storage planning", () => {
  it("only proposes files, maps specific sorts and never claims sorting frees space", () => {
    const result = planFromPrompt("Sortiere Bilder", files);
    expect(result?.actions).toEqual([{ id: "photo", name: "Urlaub.jpg", size: 150 * 1024 ** 2, operation: "move", category: "Bilder" }]);
    expect(result?.potentialBytes).toBe(0);
  });

  it("requires a positive explicit size for deletion and excludes folders", () => {
    expect(planFromPrompt("Lösche alles", files)).toBeNull();
    expect(planFromPrompt("Lösche Dateien größer als 0 MB", files)).toBeNull();
    const result = planFromPrompt("Lösche Dateien größer als 100 MB", files);
    expect(result?.actions.map(action => action.id)).toEqual(["photo"]);
    expect(result?.potentialBytes).toBe(150 * 1024 ** 2);
  });

  it("does not equate size with a verified duplicate", () => {
    const suggestions = storageSuggestions(files);
    expect(suggestions[0].title).toBe("Große Dateien prüfen");
    expect(suggestions[0].actions.map(action => action.id)).toEqual(["photo"]);
    expect(suggestions.some(item => /Duplikat/.test(item.title))).toBe(false);
  });
});

// ——— Sprint 053: erweiterte lokale Intents, Statistik und KI-Regeln ———

const DAY = 86_400_000;
const now = Date.now();
const agedFiles: StorageEntry[] = [
  { id: "old-video", name: "Urlaub.mp4", size: 600 * 1024 ** 2, modified: now - 200 * DAY, mime: "video/mp4", directory: false },
  { id: "new-video", name: "Geburtstag.mp4", size: 700 * 1024 ** 2, modified: now - 2 * DAY, mime: "video/mp4", directory: false },
  { id: "old-photo", name: "Selfie.jpg", size: 3 * 1024 ** 2, modified: now - 400 * DAY, mime: "image/jpeg", directory: false },
  { id: "doc", name: "Notizen.txt", size: 1024, modified: now, mime: "text/plain", directory: false },
];

describe("Sprint 053 — erweiterte lokale Prompt-Intents", () => {
  it("loescht ausschliesslich Dateien, die aelter als X Tage/Monate sind", () => {
    const result = planFromPrompt("Lösche Dateien älter als 100 Tage", agedFiles);
    expect(result?.actions.map(action => action.id)).toEqual(["old-video", "old-photo"]);
    const months = planFromPrompt("Lösche Dateien älter als 12 Monate", agedFiles);
    expect(months?.actions.map(action => action.id)).toEqual(["old-photo"]);
  });

  it("loescht auf Prompt eine konkrete Kategorie, nie 'alles'", () => {
    const result = planFromPrompt("Lösche alle Videos", agedFiles);
    expect(result?.actions.map(action => action.id)).toEqual(["old-video", "new-video"]);
    expect(planFromPrompt("Lösche alle", agedFiles)).toBeNull();
  });
});

describe("Sprint 053 — anonymisierte Statistik", () => {
  it("enthaelt keinerlei Namen oder Pfade und klassifiziert Groessen/Alter", () => {
    const stats = storageStats(agedFiles, 1);
    const serialized = JSON.stringify(stats);
    expect(serialized).not.toMatch(/Urlaub|Geburtstag|Selfie|Notizen|\.mp4|\.jpg|\.txt/);
    expect(stats.totalFiles).toBe(4);
    expect(stats.directories).toBe(1);
    expect(stats.categories.find(cat => cat.category === "Videos")).toMatchObject({ count: 2, over100MB: 2, over1GB: 0 });
    expect(stats.categories.find(cat => cat.category === "Bilder")?.oldRatio).toBe(1);
  });
});

describe("Sprint 053 — KI-Regeln lokal anwenden", () => {
  it("wendet Filter korrekt an und meldet freigebbaren Platz", () => {
    const plan = planFromRules([{ operation: "delete", category: "Videos", minSizeMB: 650, top: 1, reason: "Groesste zuerst." }], agedFiles);
    expect(plan?.actions.map(action => action.id)).toEqual(["new-video"]);
    expect(plan?.potentialBytes).toBe(700 * 1024 ** 2);
    expect(plan?.title).toContain("KI-Plan");
  });

  it("verwirft ungefilterte Delete-Regeln erneut (Vertrauen nie blind)", () => {
    expect(planFromRules([{ operation: "delete" }], agedFiles)).toBeNull();
  });

  it("verschiebt nur Dateien der Regel-Kategorie in Typ-Ordner", () => {
    const plan = planFromRules([{ operation: "move", category: "Bilder" }], agedFiles);
    expect(plan?.actions.map(action => action.id)).toEqual(["old-photo"]);
    expect(plan?.actions[0]?.category).toBe("Bilder");
  });

  it("kombiniert mehrere Regeln ohne doppelte Loeschungen", () => {
    const plan = planFromRules([
      { operation: "delete", olderThanDays: 150 },
      { operation: "delete", category: "Bilder", minSizeMB: 1 },
    ], agedFiles);
    const ids = plan?.actions.map(action => action.id) ?? [];
    expect(ids).toContain("old-video");
    expect(ids.filter(id => id === "old-photo")).toHaveLength(1);
  });
});
