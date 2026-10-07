import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_TAG_PATTERN,
  fullRollbackCheck,
  isSafeRollbackTarget,
  isValidCheckpointTag,
  parseCheckpointTag,
  verifyHealthInvariants,
  verifyMigrationsBackwardCompatible,
  verifyRouterConfigPersistence,
  type HealthSnapshot,
  type MigrationEntry,
  type RouterConfigState,
} from "./rollback-check";

describe("Sprint 090 — Rollback-Verifikation", () => {
  describe("parseCheckpointTag", () => {
    it("parst gueltige Checkpoint-Tags", () => {
      expect(parseCheckpointTag("release-089")).toBe(89);
      expect(parseCheckpointTag("release-100")).toBe(100);
      expect(parseCheckpointTag("release-084")).toBe(84);
    });

    it("lehnt ungueltige Tags ab", () => {
      expect(parseCheckpointTag("v1.0.0")).toBeNull();
      expect(parseCheckpointTag("release-1")).toBeNull();
      expect(parseCheckpointTag("release-abc")).toBeNull();
      expect(parseCheckpointTag("")).toBeNull();
      expect(parseCheckpointTag("release-")).toBeNull();
    });
  });

  describe("isValidCheckpointTag", () => {
    it("akzeptiert release-NNN Format", () => {
      expect(isValidCheckpointTag("release-089")).toBe(true);
      expect(isValidCheckpointTag("release-103")).toBe(true);
    });

    it("lehnt andere Formate ab", () => {
      expect(isValidCheckpointTag("v1.0.0")).toBe(false);
      expect(isValidCheckpointTag("release-1")).toBe(false);
      expect(isValidCheckpointTag("sprint-090")).toBe(false);
    });
  });

  describe("isSafeRollbackTarget", () => {
    it("erlaubt Rollback zu einem frueheren Checkpoint innerhalb des Fensters", () => {
      expect(isSafeRollbackTarget(85, 90, 80)).toBe(true);
      expect(isSafeRollbackTarget(89, 90, 84)).toBe(true);
    });

    it("verbietet Rollback zum aktuellen oder neueren Checkpoint", () => {
      expect(isSafeRollbackTarget(90, 90, 80)).toBe(false);
      expect(isSafeRollbackTarget(91, 90, 80)).toBe(false);
    });

    it("verbietet Rollback vor den aeltesten guten Checkpoint", () => {
      expect(isSafeRollbackTarget(79, 90, 80)).toBe(false);
      expect(isSafeRollbackTarget(80, 90, 80)).toBe(true); // Grenze inklusiv
    });

    it("verbietet ungueltige Nummern", () => {
      expect(isSafeRollbackTarget(0, 90, 80)).toBe(false);
      expect(isSafeRollbackTarget(-1, 90, 80)).toBe(false);
    });
  });

  describe("verifyHealthInvariants", () => {
    const goodSnapshot: HealthSnapshot = {
      ok: true,
      version: "1.1.4",
      database: { status: "verbunden" },
      routing: { activeRoute: "ollama" },
      providers: [
        { name: "ollama", configured: true, cooldown: false },
        { name: "openrouter", configured: true, cooldown: true },
      ],
    };

    it("besteht alle Invarianten bei gueltigem Snapshot", () => {
      const result = verifyHealthInvariants(goodSnapshot);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("scheitert bei ok=false", () => {
      const result = verifyHealthInvariants({ ...goodSnapshot, ok: false });
      expect(result.passed).toBe(false);
      expect(result.failures).toContain("ok ist false");
    });

    it("scheitert bei ungueltiger Version", () => {
      const result = verifyHealthInvariants({ ...goodSnapshot, version: "abc" });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("keine gueltige SemVer"))).toBe(true);
    });

    it("scheitert bei database nicht verbunden", () => {
      const result = verifyHealthInvariants({
        ...goodSnapshot,
        database: { status: "getrennt" },
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("getrennt"))).toBe(true);
    });

    it("scheitert bei activeRoute null", () => {
      const result = verifyHealthInvariants({
        ...goodSnapshot,
        routing: { activeRoute: null },
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("activeRoute"))).toBe(true);
    });

    it("scheitert wenn alle Provider im Cooldown", () => {
      const result = verifyHealthInvariants({
        ...goodSnapshot,
        providers: [
          { name: "ollama", configured: true, cooldown: true },
          { name: "openrouter", configured: false, cooldown: false },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("kein Provider"))).toBe(true);
    });

    it("besteht ohne optionale Felder (nur ok + version)", () => {
      const result = verifyHealthInvariants({ ok: true, version: "1.0.0" });
      expect(result.passed).toBe(true);
    });
  });

  describe("verifyMigrationsBackwardCompatible", () => {
    const migrations: MigrationEntry[] = [
      { id: "0001", description: "create users table", additiveOnly: true },
      { id: "0002", description: "add email column", additiveOnly: true },
      { id: "0003", description: "drop old_column", additiveOnly: false },
    ];

    it("besteht wenn alle Migrationen additiv sind", () => {
      const result = verifyMigrationsBackwardCompatible([
        { id: "0001", description: "add table", additiveOnly: true },
        { id: "0002", description: "add column", additiveOnly: true },
      ]);
      expect(result.passed).toBe(true);
    });

    it("scheitert bei nicht-additiver Migration ohne Ausnahme", () => {
      const result = verifyMigrationsBackwardCompatible(migrations);
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("0003"))).toBe(true);
    });

    it("besteht bei nicht-additiver Migration mit dokumentierter Ausnahme", () => {
      const result = verifyMigrationsBackwardCompatible(migrations, ["0003"]);
      expect(result.passed).toBe(true);
    });

    it("besteht bei leerer Migrations-Liste", () => {
      const result = verifyMigrationsBackwardCompatible([]);
      expect(result.passed).toBe(true);
    });
  });

  describe("verifyRouterConfigPersistence", () => {
    const goodState: RouterConfigState = {
      readable: true,
      validJson: true,
      override: null,
    };

    it("besteht bei lesbarer Datei, validem JSON, null-Override", () => {
      const result = verifyRouterConfigPersistence(goodState);
      expect(result.passed).toBe(true);
    });

    it("besteht bei gesetztem Override (nicht-leer)", () => {
      const result = verifyRouterConfigPersistence({
        ...goodState,
        override: "ollama",
      });
      expect(result.passed).toBe(true);
    });

    it("scheitert bei nicht lesbarer Datei", () => {
      const result = verifyRouterConfigPersistence({
        ...goodState,
        readable: false,
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("nicht lesbar"))).toBe(true);
    });

    it("scheitert bei invalidem JSON", () => {
      const result = verifyRouterConfigPersistence({
        ...goodState,
        validJson: false,
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("valides JSON"))).toBe(true);
    });

    it("scheitert bei leerem Override-String", () => {
      const result = verifyRouterConfigPersistence({
        ...goodState,
        override: "  ",
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("leerer String"))).toBe(true);
    });
  });

  describe("fullRollbackCheck", () => {
    const goodParams = {
      targetCheckpoint: 85,
      currentCheckpoint: 90,
      oldestGoodCheckpoint: 80,
      health: {
        ok: true,
        version: "1.1.4",
        database: { status: "verbunden" },
        routing: { activeRoute: "ollama" },
        providers: [{ name: "ollama", configured: true, cooldown: false }],
      } as HealthSnapshot,
      migrations: [
        { id: "0001", description: "add table", additiveOnly: true },
      ] as MigrationEntry[],
      routerConfig: {
        readable: true,
        validJson: true,
        override: null,
      } as RouterConfigState,
    };

    it("besteht bei allen Invarianten gruen", () => {
      const result = fullRollbackCheck(goodParams);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("scheitert bei unsicherem Checkpoint", () => {
      const result = fullRollbackCheck({
        ...goodParams,
        targetCheckpoint: 95, // >= current
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("kein sicherer Rollback-Ziel"))).toBe(true);
    });

    it("scheitert bei Health-Problem", () => {
      const result = fullRollbackCheck({
        ...goodParams,
        health: { ...goodParams.health, ok: false },
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("ok ist false"))).toBe(true);
    });

    it("scheitert bei nicht-kompatibler Migration", () => {
      const result = fullRollbackCheck({
        ...goodParams,
        migrations: [
          { id: "0003", description: "drop column", additiveOnly: false },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("0003"))).toBe(true);
    });

    it("scheitert bei Router-Config-Problem", () => {
      const result = fullRollbackCheck({
        ...goodParams,
        routerConfig: { ...goodParams.routerConfig, readable: false },
      });
      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.includes("nicht lesbar"))).toBe(true);
    });

    it("sammelt alle Fehler bei mehreren Problemen", () => {
      const result = fullRollbackCheck({
        ...goodParams,
        targetCheckpoint: 95,
        health: { ok: false, version: "x" },
        migrations: [{ id: "0003", description: "drop", additiveOnly: false }],
        routerConfig: { readable: false, validJson: false, override: "  " },
      });
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("CHECKPOINT_TAG_PATTERN", () => {
    it("akzeptiert 3-stellige Nummern", () => {
      expect(CHECKPOINT_TAG_PATTERN.test("release-089")).toBe(true);
    });

    it("akzeptiert 4-stellige Nummern", () => {
      expect(CHECKPOINT_TAG_PATTERN.test("release-1234")).toBe(true);
    });

    it("lehnt 2-stellige Nummern ab", () => {
      expect(CHECKPOINT_TAG_PATTERN.test("release-89")).toBe(false);
    });
  });
});
