import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateManifest, collectFiles, hashFile, type BuildManifest } from "../scripts/build-manifest";

describe("Build-Manifest (Sprint 088 — Build-Reproduzierbarkeit)", () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "build-manifest-test-"));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  describe("collectFiles", () => {
    it("sammelt alle Dateien rekursiv", () => {
      mkdirSync(join(fixtureDir, "sub"));
      writeFileSync(join(fixtureDir, "a.js"), "aaa");
      writeFileSync(join(fixtureDir, "sub", "b.js"), "bbb");
      writeFileSync(join(fixtureDir, "sub", "c.css"), "ccc");

      const files = collectFiles(fixtureDir);
      expect(files).toHaveLength(3);
      expect(files.map((f) => f.replace(fixtureDir + "/", "").replace(/\\/g, "/"))).toContain("a.js");
    });

    it("liefert sortierte Ergebnisse", () => {
      mkdirSync(join(fixtureDir, "z"));
      mkdirSync(join(fixtureDir, "a"));
      writeFileSync(join(fixtureDir, "z", "file.js"), "z");
      writeFileSync(join(fixtureDir, "a", "file.js"), "a");
      writeFileSync(join(fixtureDir, "middle.js"), "m");

      const files = collectFiles(fixtureDir);
      const relPaths = files.map((f) => f.replace(fixtureDir + "/", "").replace(/\\/g, "/"));
      expect(relPaths).toEqual([...relPaths].sort());
    });

    it("ignoriert build-manifest.json selbst bei der Erfassung", () => {
      writeFileSync(join(fixtureDir, "index.html"), "<html></html>");
      writeFileSync(join(fixtureDir, "build-manifest.json"), '{"generatedAt":"timestamp"}');

      const files = collectFiles(fixtureDir);
      const relPaths = files.map((f) => f.replace(fixtureDir + "/", "").replace(/\\/g, "/"));
      expect(relPaths).not.toContain("build-manifest.json");
      expect(relPaths).toHaveLength(1);
    });
  });

  describe("generateManifest", () => {
    it("erzeugt ein Manifest mit korrekten Feldern", () => {
      writeFileSync(join(fixtureDir, "index.html"), "<html></html>");
      writeFileSync(join(fixtureDir, "app.js"), "console.log('hello')");

      const manifest = generateManifest(fixtureDir);

      expect(manifest).toHaveProperty("generatedAt");
      expect(manifest).toHaveProperty("distPath");
      expect(manifest.fileCount).toBe(2);
      expect(manifest.totalSize).toBeGreaterThan(0);
      expect(manifest.aggregateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.files).toHaveLength(2);
    });

    it("ist deterministisch: gleiche Inhalte → gleicher Aggregat-Hash", () => {
      // Erste Fixture
      const dirA = mkdtempSync(join(tmpdir(), "manifest-a-"));
      mkdirSync(join(dirA, "assets"));
      writeFileSync(join(dirA, "index.html"), "<html><body>Hi</body></html>");
      writeFileSync(join(dirA, "assets", "main.js"), "console.log('test');");
      writeFileSync(join(dirA, "assets", "style.css"), "body{color:red}");

      // Zweite identische Fixture
      const dirB = mkdtempSync(join(tmpdir(), "manifest-b-"));
      mkdirSync(join(dirB, "assets"));
      writeFileSync(join(dirB, "index.html"), "<html><body>Hi</body></html>");
      writeFileSync(join(dirB, "assets", "main.js"), "console.log('test');");
      writeFileSync(join(dirB, "assets", "style.css"), "body{color:red}");

      const manifestA = generateManifest(dirA);
      const manifestB = generateManifest(dirB);

      expect(manifestA.aggregateHash).toBe(manifestB.aggregateHash);
      expect(manifestA.fileCount).toBe(manifestB.fileCount);
      expect(manifestA.totalSize).toBe(manifestB.totalSize);

      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    });

    it("unterschiedliche Inhalte → unterschiedlicher Aggregat-Hash", () => {
      const dirA = mkdtempSync(join(tmpdir(), "manifest-diff-a-"));
      const dirB = mkdtempSync(join(tmpdir(), "manifest-diff-b-"));

      writeFileSync(join(dirA, "file.js"), "content-a");
      writeFileSync(join(dirB, "file.js"), "content-b");

      const manifestA = generateManifest(dirA);
      const manifestB = generateManifest(dirB);

      expect(manifestA.aggregateHash).not.toBe(manifestB.aggregateHash);

      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    });

    it("Dateipfade sind relativ zum dist-Verzeichnis", () => {
      mkdirSync(join(fixtureDir, "nested", "deep"), { recursive: true });
      writeFileSync(join(fixtureDir, "nested", "deep", "file.js"), "x");

      const manifest = generateManifest(fixtureDir);
      const paths = manifest.files.map((f) => f.path);

      expect(paths).toContain("nested/deep/file.js");
      // Keine absoluten Pfade
      expect(paths.every((p) => !p.startsWith("/"))).toBe(true);
    });

    it("jeder Eintrag hat sha256, path und size", () => {
      writeFileSync(join(fixtureDir, "a.js"), "abc");

      const manifest = generateManifest(fixtureDir);
      const entry = manifest.files[0];

      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("sha256");
      expect(entry).toHaveProperty("size");
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.size).toBe(3);
    });

    it("leeres Verzeichnis → 0 Dateien, Aggregat-Hash trotzdem bestimmt", () => {
      const manifest = generateManifest(fixtureDir);
      expect(manifest.fileCount).toBe(0);
      expect(manifest.totalSize).toBe(0);
      expect(manifest.aggregateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.files).toHaveLength(0);
    });
  });

  describe("hashFile", () => {
    it("gleicher Inhalt → gleicher Hash", () => {
      const fileA = join(fixtureDir, "a.txt");
      const fileB = join(fixtureDir, "b.txt");
      writeFileSync(fileA, "identisch");
      writeFileSync(fileB, "identisch");

      expect(hashFile(fileA)).toBe(hashFile(fileB));
    });

    it("unterschiedlicher Inhalt → unterschiedlicher Hash", () => {
      const fileA = join(fixtureDir, "a.txt");
      const fileB = join(fixtureDir, "b.txt");
      writeFileSync(fileA, "eins");
      writeFileSync(fileB, "zwei");

      expect(hashFile(fileA)).not.toBe(hashFile(fileB));
    });
  });
});
