#!/usr/bin/env tsx
/**
 * Build-Manifest-Generator für Build-Reproduzierbarkeit (Sprint 087/088).
 *
 * Erzeugt ein deterministisches JSON-Manifest mit SHA-256-Hashes aller
 * Web-Build-Artefakte (dist/). Die Dateiliste wird sortiert, so dass
 * identische Builds identische Manifeste liefern.
 *
 * Das Manifest selbst (`build-manifest.json`) wird bei der Erfassung ignoriert,
 * um Zirkulärabhängigkeiten und Zeitstempel-Abweichungen bei Folge-Builds
 * zu vermeiden.
 *
 * Analog AGENTS.md-Regel: Web-Payload (`assets/public/**` und
 * `assets/capacitor.config.json`) hashen, nicht die ganze APK.
 *
 * Aufruf: tsx scripts/build-manifest.ts [--dist <path>] [--out <path>]
 * Standard: dist/ → dist/build-manifest.json
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

export interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface BuildManifest {
  generatedAt: string;
  distPath: string;
  fileCount: number;
  totalSize: number;
  aggregateHash: string;
  files: ManifestEntry[];
}

/**
 * Sammle rekursiv alle Dateien unter `dir` (sortiert).
 * Eigenes Manifest (`build-manifest.json`) wird ignoriert, damit
 * wiederholte Manifest-Generierungen deterministisch bleiben.
 */
export function collectFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string) {
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      if (entry === "build-manifest.json") continue;
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

/**
 * Berechne SHA-256-Hash einer Datei.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Erzeuge ein deterministisches Build-Manifest für `distPath`.
 */
export function generateManifest(distPath: string, baseDir?: string): BuildManifest {
  const absDist = resolve(distPath);
  const files = collectFiles(absDist).sort();

  const entries: ManifestEntry[] = files.map((f) => {
    const rel = baseDir ? relative(baseDir, f) : relative(absDist, f);
    return {
      path: rel.replace(/\\/g, "/"),
      sha256: hashFile(f),
      size: statSync(f).size,
    };
  });

  // Aggregat-Hash über alle Einzeldatei-Hashes (deterministisch)
  const hashInput = entries.map((e) => `${e.sha256}  ${e.path}`).join("\n");
  const aggregateHash = createHash("sha256").update(hashInput).digest("hex");

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  return {
    generatedAt: new Date().toISOString(),
    distPath: absDist,
    fileCount: entries.length,
    totalSize,
    aggregateHash,
    files: entries,
  };
}

/**
 * Schreibe Manifest als JSON (sortierte Keys für Determinismus).
 */
export function writeManifest(manifest: BuildManifest, outPath: string): void {
  const json = JSON.stringify(manifest, null, 2);
  const outDir = dirname(outPath);
  if (!statSync(outDir, { throwIfNoEntry: false })) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outPath, json + "\n", "utf-8");
}

// --- CLI ---

function main() {
  const args = process.argv.slice(2);
  let distPath = "dist";
  let outPath = "dist/build-manifest.json";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dist" && args[i + 1]) {
      distPath = args[i + 1];
      i++;
    } else if (args[i] === "--out" && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }

  try {
    statSync(distPath);
  } catch {
    console.error(`Fehler: Verzeichnis '${distPath}' existiert nicht. Vorher 'pnpm build' ausführen.`);
    process.exit(1);
  }

  const manifest = generateManifest(distPath);
  writeManifest(manifest, outPath);

  console.log(`Build-Manifest geschrieben: ${outPath}`);
  console.log(`  Dateien: ${manifest.fileCount}`);
  console.log(`  Gesamtgröße: ${manifest.totalSize} Bytes`);
  console.log(`  Aggregat-Hash: ${manifest.aggregateHash}`);
}

// Only run CLI when executed directly (not when imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
