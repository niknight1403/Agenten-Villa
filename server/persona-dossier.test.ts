import { describe, it, expect } from "vitest";
import {
  AI_DISCLOSURE_BLOCK,
  buildSystemPrompt,
  hasAiDisclosure,
  validatePersona,
  PersonaDisclosureError,
  seedPersonas,
  nextAssetStatus,
  assetJobRunnable,
} from "./persona-dossier";

describe("Persona-Dossier (Abschnitt 3.1)", () => {
  it("erkennt die AI-Kennzeichnung im System-Prompt", () => {
    expect(hasAiDisclosure(AI_DISCLOSURE_BLOCK)).toBe(true);
    expect(hasAiDisclosure("Du bist ein netter Assistent.")).toBe(false);
    expect(hasAiDisclosure("Du bist eine KI-Entitaet und hilfst Menschen.")).toBe(true);
  });

  it("buildSystemPrompt erzwingt die Kennzeichnung strukturell", () => {
    const prompt = buildSystemPrompt({
      displayName: "Test",
      tagline: "Test-Tagline",
      styleguide: "## Ton\n- Test",
      characterSheet: { stimme: "ruhig" },
    });
    expect(prompt).toContain("KI-Entitaet");
    expect(prompt).toContain("Test");
    expect(prompt).toContain("stimme: ruhig");
  });

  it("validatePersona lehnt Personas ohne Kennzeichnung ab", () => {
    const base = {
      handle: "test",
      displayName: "Test",
      systemPrompt: "Du bist ein Assistent.",
      aiDisclosure: true,
      themes: ["a"],
      channels: ["blog"],
    };
    expect(() => validatePersona(base)).toThrow(PersonaDisclosureError);
    expect(() => validatePersona({ ...base, systemPrompt: AI_DISCLOSURE_BLOCK })).not.toThrow();
    expect(() =>
      validatePersona({ ...base, systemPrompt: AI_DISCLOSURE_BLOCK, aiDisclosure: false })
    ).toThrow(PersonaDisclosureError);
  });

  it("validiert Handle und Pflichtfelder", () => {
    const valid = {
      handle: "nova",
      displayName: "Nova",
      systemPrompt: AI_DISCLOSURE_BLOCK,
      aiDisclosure: true,
      themes: ["Tech"],
      channels: ["youtube"],
    };
    expect(() => validatePersona({ ...valid, handle: "UP" })).toThrow();
    expect(() => validatePersona({ ...valid, displayName: " " })).toThrow();
    expect(() => validatePersona({ ...valid, themes: [] })).toThrow();
    expect(() => validatePersona({ ...valid, channels: [] })).toThrow();
  });

  it("seedPersonas liefert drei vollstaendige, gekennzeichnete Personas", () => {
    const seeds = seedPersonas();
    expect(seeds).toHaveLength(3);
    for (const p of seeds) {
      expect(p.aiDisclosure).toBe(true);
      expect(hasAiDisclosure(p.systemPrompt)).toBe(true);
      expect(p.themes.length).toBeGreaterThan(0);
      expect(p.channels.length).toBeGreaterThan(0);
    }
    expect(seeds.map((p) => p.handle)).toEqual(["nova", "lumen", "quark"]);
  });

  it("Asset-Pipeline-Zustaende: pending → generating → ready/failed", () => {
    expect(nextAssetStatus("pending", true)).toBe("generating");
    expect(nextAssetStatus("generating", true)).toBe("ready");
    expect(nextAssetStatus("generating", false)).toBe("failed");
    expect(nextAssetStatus("ready", false)).toBe("ready");
    expect(assetJobRunnable("pending")).toBe(true);
    expect(assetJobRunnable("failed")).toBe(true);
    expect(assetJobRunnable("generating")).toBe(false);
    expect(assetJobRunnable("ready")).toBe(false);
  });
});
