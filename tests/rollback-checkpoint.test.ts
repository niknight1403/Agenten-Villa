import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCheckpoint,
  verifyCheckpoint,
  restoreCheckpoint,
  hashFile,
  DB_MIGRATION_POLICY,
  type CheckpointManifest,
} from "../scripts/rollback-checkpoint";

describe("Rollback-Checkpoint & Restoration (Sprint 089 — Rollback-Test)", () => {
  let sourceDir: string;
  let checkpointDir: string;
  let targetDir: string;

  beforeEach(() => {
    sourceDir = mkdtempSync(join(tmpdir(), "rollback-source-"));
    checkpointDir = mkdtempSync(join(tmpdir(), "rollback-chk-"));
    targetDir = mkdtempSync(join(tmpdir(), "rollback-target-"));
  });

  afterEach(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(checkpointDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  describe("createCheckpoint", () => {
    it("erzeugt einen gültigen Checkpoint mit Manifest und Kopien", () => {
      mkdirSync(join(sourceDir, "sub"));
      writeFileSync(join(sourceDir, "config.json"), '{"env":"prod"}');
      writeFileSync(join(sourceDir, "sub", "data.txt"), "Hallo World");

      const manifest = createCheckpoint(sourceDir, checkpointDir, "v1.0.0-snapshot");

      expect(manifest.version).toBe(1);
      expect(manifest.label).toBe("v1.0.0-snapshot");
      expect(manifest.fileCount).toBe(2);
      expect(manifest.aggregateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.dbMigrationNotice).toBe(DB_MIGRATION_POLICY);
      expect(existsSync(join(checkpointDir, "checkpoint-manifest.json"))).toBe(true);
      expect(existsSync(join(checkpointDir, "config.json"))).toBe(true);
      expect(existsSync(join(checkpointDir, "sub", "data.txt"))).toBe(true);
    });

    it("wirft Fehler bei nicht existierendem Quellverzeichnis", () => {
      const nonExistent = join(tmpdir(), "does-not-exist-12345");
      expect(() => createCheckpoint(nonExistent, checkpointDir)).toThrow(/existiert nicht/);
    });
  });

  describe("verifyCheckpoint", () => {
    it("bestätigt die Gültigkeit eines unveränderten Checkpoints", () => {
      writeFileSync(join(sourceDir, "file.txt"), "Inhalt");
      createCheckpoint(sourceDir, checkpointDir, "chk-1");

      const res = verifyCheckpoint(checkpointDir);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.manifest?.label).toBe("chk-1");
    });

    it("meldet Ungültigkeit bei manipulierter Datei", () => {
      writeFileSync(join(sourceDir, "file.txt"), "Original");
      createCheckpoint(sourceDir, checkpointDir, "chk-1");

      // Datei im Checkpoint verändern
      writeFileSync(join(checkpointDir, "file.txt"), "Manipuliert");

      const res = verifyCheckpoint(checkpointDir);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Hash-Abweichung"))).toBe(true);
    });

    it("meldet Ungültigkeit bei fehlender Datei im Checkpoint", () => {
      writeFileSync(join(sourceDir, "file1.txt"), "A");
      writeFileSync(join(sourceDir, "file2.txt"), "B");
      createCheckpoint(sourceDir, checkpointDir, "chk-1");

      // Eine Datei aus dem Checkpoint entfernen
      rmSync(join(checkpointDir, "file2.txt"));

      const res = verifyCheckpoint(checkpointDir);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Datei fehlt"))).toBe(true);
    });

    it("meldet Ungültigkeit bei unerwarteten Zusatzdateien", () => {
      writeFileSync(join(sourceDir, "file1.txt"), "A");
      createCheckpoint(sourceDir, checkpointDir, "chk-1");

      // Unerwartete Datei hinzufügen
      writeFileSync(join(checkpointDir, "extra.txt"), "Spam");

      const res = verifyCheckpoint(checkpointDir);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Unerwartete Datei"))).toBe(true);
    });

    it("meldet Ungültigkeit bei fehlendem Manifest", () => {
      writeFileSync(join(sourceDir, "file.txt"), "X");
      createCheckpoint(sourceDir, checkpointDir, "chk-1");

      rmSync(join(checkpointDir, "checkpoint-manifest.json"));

      const res = verifyCheckpoint(checkpointDir);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("fehlt");
    });
  });

  describe("restoreCheckpoint & Idempotenz", () => {
    it("stellt Zustand im Zielverzeichnis korrekt her", () => {
      mkdirSync(join(sourceDir, "assets"));
      writeFileSync(join(sourceDir, "index.html"), "<h1>Start</h1>");
      writeFileSync(join(sourceDir, "assets", "app.js"), "console.log(1);");

      createCheckpoint(sourceDir, checkpointDir, "release-1");

      const res = restoreCheckpoint(checkpointDir, targetDir);

      expect(res.success).toBe(true);
      expect(res.restoredFiles).toBe(2);
      expect(readFileSync(join(targetDir, "index.html"), "utf-8")).toBe("<h1>Start</h1>");
      expect(readFileSync(join(targetDir, "assets", "app.js"), "utf-8")).toBe("console.log(1);");
    });

    it("bereinigt neu hinzukommende / veränderte Dateien im Zielverzeichnis", () => {
      writeFileSync(join(sourceDir, "stable.txt"), "alt");
      createCheckpoint(sourceDir, checkpointDir, "chk-clean");

      // Zielverzeichnis hat abweichenden Inhalt und zusätzliche Datei
      writeFileSync(join(targetDir, "stable.txt"), "neu-geändert");
      writeFileSync(join(targetDir, "unwanted.txt"), "soll weg");

      const res = restoreCheckpoint(checkpointDir, targetDir, { cleanTarget: true });

      expect(res.success).toBe(true);
      expect(res.cleanedFiles).toBe(1);
      expect(existsSync(join(targetDir, "unwanted.txt"))).toBe(false);
      expect(readFileSync(join(targetDir, "stable.txt"), "utf-8")).toBe("alt");
    });

    it("ist Idempotent: Mehrfache Wiederherstellung liefert identischen Zustand und Hash", () => {
      mkdirSync(join(sourceDir, "nested"));
      writeFileSync(join(sourceDir, "a.json"), '{"key":"value"}');
      writeFileSync(join(sourceDir, "nested", "b.bin"), "123456789");

      createCheckpoint(sourceDir, checkpointDir, "chk-idempotent");

      // 1. Wiederherstellung
      const res1 = restoreCheckpoint(checkpointDir, targetDir);
      const hash1 = res1.aggregateHash;
      const file1HashA = hashFile(join(targetDir, "a.json"));

      // 2. Wiederherstellung
      const res2 = restoreCheckpoint(checkpointDir, targetDir);
      const hash2 = res2.aggregateHash;
      const file2HashA = hashFile(join(targetDir, "a.json"));

      // 3. Wiederherstellung
      const res3 = restoreCheckpoint(checkpointDir, targetDir);
      const hash3 = res3.aggregateHash;

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
      expect(file1HashA).toBe(file2HashA);
      expect(res2.cleanedFiles).toBe(0);
      expect(res3.cleanedFiles).toBe(0);
    });

    it("verweigert Wiederherstellung bei beschädigtem Checkpoint", () => {
      writeFileSync(join(sourceDir, "file.txt"), "A");
      createCheckpoint(sourceDir, checkpointDir, "corrupt-test");

      // Checkpoint korrumpieren
      writeFileSync(join(checkpointDir, "file.txt"), "B");

      expect(() => restoreCheckpoint(checkpointDir, targetDir)).toThrow(/Integritätsprüfung fehlgeschlagen/);
    });

    it("dokumentiert die DB-Migrations-Richtlinie im Manifest", () => {
      writeFileSync(join(sourceDir, "schema.sql"), "CREATE TABLE demo;");
      const manifest = createCheckpoint(sourceDir, checkpointDir, "db-test");

      expect(manifest.dbMigrationNotice).toContain("BRANCH-PROTECTION.md");
      expect(manifest.dbMigrationNotice).toContain("nicht automatisch rückwärts");
    });
  });
});
