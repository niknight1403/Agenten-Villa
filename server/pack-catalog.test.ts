import { describe, expect, it } from "vitest";
import { CAPABILITY_PACKS } from "./agent-villa";
import { capabilityPackSchema, getPackCatalog } from "./pack-catalog";

describe("Capability-Pack-Katalog (Sprint 042)", () => {
  const catalog = getPackCatalog();

  it("katalogisiert jedes Pack mit Zweck, Berechtigungen und Grenzen", () => {
    expect(catalog).toHaveLength(CAPABILITY_PACKS.length);
    for (const entry of catalog) {
      expect(entry.purpose.length).toBeGreaterThanOrEqual(20);
      expect(entry.permissions.length).toBeGreaterThanOrEqual(1);
      expect(entry.limits.length).toBeGreaterThanOrEqual(1);
      expect(() => capabilityPackSchema.parse(entry)).not.toThrow();
    }
  });

  it("hat eindeutige Pack-IDs in stabiler Reihenfolge", () => {
    const ids = catalog.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(CAPABILITY_PACKS.map(pack => pack.id));
  });

  it("kennzeichnet administratoren-only Packs korrekt", () => {
    const draftWrites = catalog.find(entry => entry.id === "github-draft-writes");
    expect(draftWrites?.administratorOnly).toBe(true);
    expect(draftWrites?.limits.some(l => l.includes("Default-Branch"))).toBe(true);
    const workshop = catalog.find(entry => entry.id === "project-workshop");
    expect(workshop?.administratorOnly).toBe(false);
  });

  it("enthält keine geheimen Werte (nur Beschreibungen über Rechte)", () => {
    const serialized = JSON.stringify(catalog);
    // Das Wort „Token“ in Grenz-Beschreibungen ist erlaubt — echte
    // Geheimnis-Werte (Präfixe echter Keys) niemals.
    expect(serialized).not.toMatch(/ghp_[A-Za-z0-9]|hf_[A-Za-z0-9]|sk-[A-Za-z0-9]|AKIA[A-Za-z0-9]|Bearer\s+[A-Za-z0-9_-]{8,}/);
  });
});
