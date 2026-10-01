/**
 * Sprint 053 — Speicher-Berater: Prompt-Bau, Schema-Validierung und
 * lokale Sicherheitsgrenzen der KI-Regeln.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetProviderChainForTests } from "./agent-engine";
import { resetProviderGuardianForTests } from "./provider-guardian";
import {
  buildStorageAdvisorPrompt,
  runStorageAdvisor,
} from "./storage-advisor";
import { parseAdvisorAnswer } from "@shared/storage-advisor";

const stats = {
  totalFiles: 120,
  totalBytes: 3 * 1024 ** 3,
  directories: 4,
  categories: [
    { category: "Videos" as const, count: 20, bytes: 2 * 1024 ** 3, oldRatio: 0.5, over100MB: 15, over1GB: 2 },
    { category: "Bilder" as const, count: 100, bytes: 1024 ** 3, oldRatio: 0.1, over100MB: 3, over1GB: 0 },
  ],
};

const advisorReply = (content: string) =>
  new Response(JSON.stringify({ model: "advisor-test", choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetProviderGuardianForTests();
  resetProviderChainForTests();
});

describe("buildStorageAdvisorPrompt", () => {
  it("enthält Nutzer-Auftrag und anonymisierte Statistiken, keine Dateinamen", () => {
    const prompt = buildStorageAdvisorPrompt("Mach Platz für Videos", stats);
    expect(prompt).toContain("Mach Platz für Videos");
    expect(prompt).toContain("Videos: 20 Dateien");
    expect(prompt).toContain("50 % aelter als 180 Tage");
    expect(prompt).not.toMatch(/Urlaub|photo|\.jpg|\.mp4/);
  });
});

describe("parseAdvisorAnswer (Sicherheitsschicht)", () => {
  it("akzeptiert valide JSON-Antworten und begrenzt summary und rules", () => {
    const answer = parseAdvisorAnswer(
      '{"summary":"Grosse Videos pruefen.","rules":[{"operation":"delete","category":"Videos","minSizeMB":500,"top":10,"reason":"Platz"}]}'
    );
    expect(answer.rules).toHaveLength(1);
    expect(answer.rules[0]?.top).toBe(10);
  });

  it("verwirft ungefilterte Delete-Regeln ('alles loeschen' ist unmoeglich)", () => {
    const answer = parseAdvisorAnswer(
      '{"summary":"x","rules":[{"operation":"delete"},{"operation":"delete","category":"Videos"}]}'
    );
    expect(answer.rules).toHaveLength(1);
    expect(answer.rules[0]?.category).toBe("Videos");
  });

  it("lehnt kaputtes JSON und Schema-Verletzungen ab", () => {
    expect(() => parseAdvisorAnswer("Kein JSON hier")).toThrow("ADVISOR_NO_JSON");
    expect(() => parseAdvisorAnswer("{broken}")).toThrow("ADVISOR_INVALID_JSON");
    expect(() => parseAdvisorAnswer('{"summary":"x","rules":[{"operation":"delete","minSizeMB":-5}]}')).toThrow("ADVISOR_SCHEMA_INVALID");
    expect(() => parseAdvisorAnswer('{"rules":[]}')).toThrow("ADVISOR_SCHEMA_INVALID");
  });
});

describe("runStorageAdvisor", () => {
  it("liefert validierte Regeln mit Provider-Metadaten", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      advisorReply('{"summary":"Grosse Videos zuerst.","rules":[{"operation":"delete","category":"Videos","minSizeMB":800,"top":10,"reason":"Platz schaffen"}]}')
    );
    const result = await runStorageAdvisor({ prompt: "Räume den Ordner auf", stats }, { fetcher });
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("advisor-test");
    expect(result.rules[0]?.category).toBe("Videos");
    expect(result.summary).toContain("Videos");
  });

  it("leitet ungueltige Stats und leere Prompts explizit ab", async () => {
    await expect(runStorageAdvisor({ prompt: "  ", stats })).rejects.toThrow("ADVISOR_EMPTY_PROMPT");
    await expect(runStorageAdvisor({ prompt: "Test", stats: { totalFiles: -1 } })).rejects.toThrow("ADVISOR_STATS_INVALID");
  });

  it("uebersetzt unparseierbare Modell-Antworten in einen klaren Fehler", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(advisorReply("Ich denke, man sollte..."));
    await expect(runStorageAdvisor({ prompt: "Vorschlaege bitte", stats }, { fetcher })).rejects.toThrow("ADVISOR_NO_JSON");
  });
});
