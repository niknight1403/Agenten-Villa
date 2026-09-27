import { describe, expect, it } from "vitest";
import { planFromPrompt, storageSuggestions, type StorageEntry } from "./storage-plan";

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
