/**
 * Sprint 095 — Erweiterungspunkte: Neue Provider, Packs und Phasen koennen
 * ohne Kernumbau ergaenzt werden. Diese Tests beweisen genau das:
 *
 *  - Provider: registerLLMProvider() meldet einen neuen Anbieter an; der
 *    Fallback-Loop verwendet ihn inklusive eigener URL-Konstruktion,
 *    ohne dass der Kern angefasst wird.
 *  - Phasen: das Strategie-Register liefert Schema, Prompt und Parser;
 *    eine neue Phase waere ein reiner Registereintrag.
 *  - Packs: buildPackCatalog() katalogisiert beliebige Pack-Listen;
 *    ein fehlender Authority-Eintrag wirft weiterhin ehrlich.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithFallback,
  registerLLMProvider,
  resetLLMProvidersForTests,
} from "./_core/llm-router";
import {
  MISSION_STRATEGIES,
  MISSION_STRATEGY_IDS,
  missionStrategySchema,
  parseStrategyRecommendation,
  strategyChoicePrompt,
} from "./mission-strategies";
import { buildPackCatalog, getPackCatalog } from "./pack-catalog";
import { CAPABILITY_PACKS } from "./agent-villa";

describe("Erweiterungspunkt Provider (Sprint 095)", () => {
  beforeEach(() => {
    resetLLMProvidersForTests();
  });
  afterEach(() => {
    resetLLMProvidersForTests();
    vi.restoreAllMocks();
  });

  it("ein neuer Provider laeuft ohne Kernumbau im Fallback-Loop", async () => {
    registerLLMProvider({
      name: "test-provider",
      url: "https://example.invalid/v1/chat/completions",
      apiKey: () => "test-key",
      model: "test-model",
      authHeader: () => ({ authorization: "Bearer test-key" }),
      buildUrl: (key) => `https://example.test/v1/chat?key=${key}`,
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok": true}', { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithFallback(
      { messages: [] },
      { method: "POST", headers: {}, body: "{}" }
    );

    expect(response.ok).toBe(true);
    // Der neue Provider wurde wirklich angefragt — mit seiner eigenen
    // URL-Konstruktion (Key als Query-Param) und Reihenfolge NACH den Defaults:
    const calledUrl = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(calledUrl).toContain("https://example.test/v1/chat?key=test-key");
  });

  it("gleichnamige Registrierung aktualisiert statt zu verdoppeln", () => {
    registerLLMProvider({
      name: "test-provider",
      url: "https://a.test/v1",
      apiKey: () => "key-1",
      model: "m1",
      authHeader: () => ({}),
    });
    registerLLMProvider({
      name: "test-provider",
      url: "https://b.test/v1",
      apiKey: () => "key-2",
      model: "m2",
      authHeader: () => ({}),
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    return fetchWithFallback(
      {},
      { method: "POST", headers: {}, body: "{}" }
    ).then((response) => {
      expect(response.status).toBe(200);
      const urls = (fetchMock.mock.calls as unknown as Array<[string]>).map(
        (call) => call[0]
      );
      // b.test-URL wurde benutzt; a.test vom Update verdraengt.
      expect(urls).toContain("https://b.test/v1");
      expect(urls).not.toContain("https://a.test/v1");
    });
  });

  it("resetLLMProvidersForTests stellt die Defaults wieder her", () => {
    registerLLMProvider({
      name: "temporary",
      url: "https://temp.test/v1",
      apiKey: () => "k",
      model: "m",
      authHeader: () => ({}),
    });
    resetLLMProvidersForTests();
    // Ein Provider ohne Key ist nicht verfuegbar — die Registry kennt
    // "temporary" nach dem Reset nicht mehr:
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    return fetchWithFallback(
      {},
      { method: "POST", headers: {}, body: "{}" }
    ).then(
      () => {
        throw new Error("haette fehlschlagen muessen");
      },
      (error: Error) => {
        expect(error.message).toContain("erschöpft");
        // "temporary" wurde nie angefragt, weil es nicht mehr registriert ist:
        const urls = (fetchMock.mock.calls as unknown as Array<[string]>).map(
          (call) => call[0]
        );
        expect(urls.some((url) => String(url).includes("temp.test"))).toBe(
          false
        );
      }
    );
  });
});

describe("Erweiterungspunkt Phasen (Sprint 095)", () => {
  it("Schema und Prompt stammen beide aus demselben Register", () => {
    for (const id of MISSION_STRATEGY_IDS) {
      expect(missionStrategySchema.safeParse(id).success).toBe(true);
    }
    expect(missionStrategySchema.safeParse("UNKNOWN").success).toBe(false);

    const prompt = strategyChoicePrompt();
    for (const strategy of MISSION_STRATEGIES) {
      expect(prompt.join(" ")).toContain(strategy.id);
    }
    // Prompt bleibt im Sprint-071-Format: nummerierte Auswahl + Pflichtzeile.
    expect(prompt.some((line) => /^\d\)/.test(line.trim()))).toBe(true);
    expect(prompt.at(-1)).toContain("Beende die Antwort zwingend");
  });

  it("Parser akzeptiert nur registrierte Strategien", () => {
    expect(parseStrategyRecommendation("... \nEMPFEHLUNG: OPTIMIZE")).toBe(
      "OPTIMIZE"
    );
    expect(parseStrategyRecommendation("EMPFEHLUNG: REBUILD")).toBe(
      "REBUILD"
    );
    expect(
      parseStrategyRecommendation("EMPFEHLUNG: REFURNISH")
    ).toBeNull();
    expect(parseStrategyRecommendation("keine Empfehlung")).toBeNull();
  });
});

describe("Erweiterungspunkt Packs (Sprint 095)", () => {
  it("buildPackCatalog katalogisiert neue Packs ohne Builder-Aenderung", () => {
    const newPack = [
      {
        id: "test-pack",
        name: "Test-Pack",
        kind: "skill",
        description: "Ein Pack, das nur die Erweiterbarkeit prueft und sonst nichts tut.",
        enabledByDefault: false,
      },
    ];
    const catalog = buildPackCatalog(newPack, {
      "test-pack": {
        permissions: ["Nur fuer diesen Test katalogisiert"],
        limits: ["Wirft nie in Produktion"],
      },
    });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: "test-pack",
      kind: "skill",
      administratorOnly: false,
    });
  });

  it("fehlende Authority wirft weiterhin ehrlich", () => {
    expect(() =>
      buildPackCatalog(
        [{ id: "unbekannt", name: "X", kind: "tool", description: "x".repeat(20), enabledByDefault: false }],
        {}
      )
    ).toThrow(/nicht katalogisiert/);
  });

  it("der produktive Katalog bleibt vollstaendig und validiert", () => {
    const catalog = getPackCatalog();
    expect(catalog.length).toBe(CAPABILITY_PACKS.length);
    for (const entry of catalog) {
      expect(entry.purpose.length).toBeGreaterThanOrEqual(20);
      expect(entry.permissions.length).toBeGreaterThan(0);
      expect(entry.limits.length).toBeGreaterThan(0);
    }
  });
});
