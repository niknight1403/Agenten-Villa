#!/usr/bin/env tsx
/**
 * Checkpoint- & Rollback-Skript für Sprint 089 (Rollback-Test).
 *
 * Ermöglicht das Erstellen, Verifizieren und Wiederherstellen von System-Checkpoints
 * (z. B. Konfigurationen, Artefakte, lokaler Zustand).
 *
 * Regeln gemäß docs/BRANCH-PROTECTION.md & docs/RELEASE-CHECKLISTE.md:
 * - Ein Rollback stellt den exakten Checkpoint-Zustand deterministisch wieder her.
 * - DB-Migrationen werden NIE automatisch rückwärts ausgeführt, da Schema-Rollbacks
 *   mögliche Datenverluste verursachen können. Ein DB-Rollback muss explizit und
 *   getestet dokumentiert sein.
 *
 * Aufruf-Beispiele:
 *   tsx scripts/rollback-checkpoint.ts create --source <dir> --out <checkpointDir> [--label <text>]
 *   tsx scripts/rollback-checkpoint.ts verify --checkpoint <checkpointDir>
 *   tsx scripts/rollback-checkpoint.ts restore --checkpoint <checkpointDir> --target <dir> [--no-clean]
 */

import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

export const DB_MIGRATION_POLICY =
  "DB-Migrationen werden laut BRANCH-PROTECTION.md nicht automatisch rückwärts ausgeführt. Ein Schema-Rollback erfordert explizit vorab getestete Rückwärts-Migrationsskripte.";

export interface CheckpointFileEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface CheckpointManifest {
  version: number;
  label: string;
  createdAt: string;
  fileCount: number;
  totalSize: number;
  aggregateHash: string;
  dbMigrationNotice: string;
  files: CheckpointFileEntry[];
}

export interface VerifyResult {
  valid: boolean;
  errors: string[];
  manifest?: CheckpointManifest;
}

export interface RestoreResult {
  success: boolean;
  restoredFiles: number;
  cleanedFiles: number;
  aggregateHash: string;
  label: string;
  restoredAt: string;
}

/**
 * Rekursive Sammlung aller Dateipfade im Verzeichnis `dir` (relativ zu `baseDir` oder `dir`).
 * `checkpoint-manifest.json` wird ignoriert.
 */
export function collectFiles(dir: string, baseDir?: string): string[] {
  const root = resolve(dir);
  const base = baseDir ? resolve(baseDir) : root;
  const results: string[] = [];

  function walk(current: string) {
    if (!existsSync(current)) return;
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      if (entry === "checkpoint-manifest.json") continue;
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const rel = relative(base, fullPath).replace(/\\/g, "/");
        results.push(rel);
      }
    }
  }

  walk(root);
  return results.sort();
}

/**
 * Berechnet den SHA-256 Hash einer Datei.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Berechnet den aggregierten SHA-256 Hash über eine geordnete Liste von Dateieinträgen.
 */
export function computeAggregateHash(files: CheckpointFileEntry[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const input = sorted.map((f) => `${f.sha256}  ${f.path}`).join("\n");
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Legt einen Checkpoint von `sourceDir` unter `checkpointDir` an.
 */
export function createCheckpoint(
  sourceDir: string,
  checkpointDir: string,
  label: string = "unlabeled-checkpoint"
): CheckpointManifest {
  const absSource = resolve(sourceDir);
  const absCheckpoint = resolve(checkpointDir);

  if (!existsSync(absSource)) {
    throw new Error(`Quellverzeichnis '${absSource}' existiert nicht.`);
  }

  if (existsSync(absCheckpoint)) {
    rmSync(absCheckpoint, { recursive: true, force: true });
  }
  mkdirSync(absCheckpoint, { recursive: true });

  const relFiles = collectFiles(absSource, absSource);
  const fileEntries: CheckpointFileEntry[] = [];

  for (const relPath of relFiles) {
    const srcFile = join(absSource, relPath);
    const destFile = join(absCheckpoint, relPath);

    mkdirSync(dirname(destFile), { recursive: true });
    copyFileSync(srcFile, destFile);

    const sha256 = hashFile(destFile);
    const size = statSync(destFile).size;
    fileEntries.push({ path: relPath, sha256, size });
  }

  const aggregateHash = computeAggregateHash(fileEntries);
  const totalSize = fileEntries.reduce((sum, f) => sum + f.size, 0);

  const manifest: CheckpointManifest = {
    version: 1,
    label,
    createdAt: new Date().toISOString(),
    fileCount: fileEntries.length,
    totalSize,
    aggregateHash,
    dbMigrationNotice: DB_MIGRATION_POLICY,
    files: fileEntries,
  };

  const manifestPath = join(absCheckpoint, "checkpoint-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  return manifest;
}

/**
 * Prüft die Integrität eines bestehenden Checkpoints in `checkpointDir`.
 */
export function verifyCheckpoint(checkpointDir: string): VerifyResult {
  const absCheckpoint = resolve(checkpointDir);
  const manifestPath = join(absCheckpoint, "checkpoint-manifest.json");

  if (!existsSync(manifestPath)) {
    return {
      valid: false,
      errors: [`Manifest-Datei 'checkpoint-manifest.json' fehlt in '${absCheckpoint}'.`],
    };
  }

  let manifest: CheckpointManifest;
  try {
    const content = readFileSync(manifestPath, "utf-8");
    manifest = JSON.parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`Manifest in '${manifestPath}' konnte nicht gelesen/geparst werden: ${msg}`],
    };
  }

  const errors: string[] = [];
  const actualRelFiles = collectFiles(absCheckpoint, absCheckpoint);
  const manifestPaths = new Set(manifest.files.map((f) => f.path));

  // Prüfe auf unerwartete Dateien im Checkpoint
  for (const relFile of actualRelFiles) {
    if (!manifestPaths.has(relFile)) {
      errors.push(`Unerwartete Datei im Checkpoint gefunden: '${relFile}'`);
    }
  }

  // Prüfe verzeichnete Dateien
  const actualEntries: CheckpointFileEntry[] = [];
  for (const entry of manifest.files) {
    const filePath = join(absCheckpoint, entry.path);
    if (!existsSync(filePath)) {
      errors.push(`Datei fehlt im Checkpoint: '${entry.path}'`);
      continue;
    }

    const actualHash = hashFile(filePath);
    const actualSize = statSync(filePath).size;

    if (actualHash !== entry.sha256) {
      errors.push(`Hash-Abweichung bei '${entry.path}': erwartet ${entry.sha256}, erhalten ${actualHash}`);
    }
    if (actualSize !== entry.size) {
      errors.push(`Größen-Abweichung bei '${entry.path}': erwartet ${entry.size} Bytes, erhalten ${actualSize} Bytes`);
    }

    actualEntries.push({ path: entry.path, sha256: actualHash, size: actualSize });
  }

  const computedAggregate = computeAggregateHash(actualEntries);
  if (computedAggregate !== manifest.aggregateHash) {
    errors.push(
      `Aggregat-Hash-Abweichung im Checkpoint: erwartet ${manifest.aggregateHash}, berechnet ${computedAggregate}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    manifest,
  };
}

/**
 * Stellt einen verifizierten Checkpoint von `checkpointDir` in `targetDir` wieder her.
 * `cleanTarget: true` entfernt alle Dateien in `targetDir`, die nicht Teil des Checkpoints sind.
 */
export function restoreCheckpoint(
  checkpointDir: string,
  targetDir: string,
  options: { cleanTarget?: boolean } = {}
): RestoreResult {
  const cleanTarget = options.cleanTarget ?? true;
  const absCheckpoint = resolve(checkpointDir);
  const absTarget = resolve(targetDir);

  // 1. Verifiziere Quell-Checkpoint
  const verification = verifyCheckpoint(absCheckpoint);
  if (!verification.valid || !verification.manifest) {
    throw new Error(`Konnte Checkpoint nicht wiederherstellen, Integritätsprüfung fehlgeschlagen: ${verification.errors.join("; ")}`);
  }

  const manifest = verification.manifest;
  const manifestPaths = new Set(manifest.files.map((f) => f.path));

  // 2. Bereinige Zielverzeichnis falls gefordert
  let cleanedFiles = 0;
  if (existsSync(absTarget) && cleanTarget) {
    const currentTargetFiles = collectFiles(absTarget, absTarget);
    for (const relPath of currentTargetFiles) {
      if (!manifestPaths.has(relPath)) {
        const fullPath = join(absTarget, relPath);
        rmSync(fullPath, { force: true });
        cleanedFiles++;
      }
    }
  }

  if (!existsSync(absTarget)) {
    mkdirSync(absTarget, { recursive: true });
  }

  // 3. Kopiere Checkpoint-Dateien ins Ziel
  let restoredFiles = 0;
  for (const entry of manifest.files) {
    const srcPath = join(absCheckpoint, entry.path);
    const destPath = join(absTarget, entry.path);

    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);

    // Verifiziere kopierte Datei
    const copiedHash = hashFile(destPath);
    if (copiedHash !== entry.sha256) {
      throw new Error(`Wiederherstellung fehlgeschlagen für '${entry.path}': Hash stimmt nicht überein.`);
    }
    restoredFiles++;
  }

  // 4. Verifiziere Zielzustand gegen Checkpoint-Manifest
  const restoredTargetFiles = collectFiles(absTarget, absTarget);
  const restoredEntries: CheckpointFileEntry[] = restoredTargetFiles.map((relPath) => {
    const p = join(absTarget, relPath);
    return {
      path: relPath,
      sha256: hashFile(p),
      size: statSync(p).size,
    };
  });

  const targetAggregateHash = computeAggregateHash(restoredEntries);
  if (targetAggregateHash !== manifest.aggregateHash) {
    throw new Error(
      `Wiederherstellungsverifikation fehlgeschlagen: Ziel-Aggregat-Hash ${targetAggregateHash} weicht von Checkpoint ${manifest.aggregateHash} ab.`
    );
  }

  return {
    success: true,
    restoredFiles,
    cleanedFiles,
    aggregateHash: targetAggregateHash,
    label: manifest.label,
    restoredAt: new Date().toISOString(),
  };
}

// --- CLI Runner ---

function printUsage() {
  console.log(`
Verwendung:
  tsx scripts/rollback-checkpoint.ts create --source <dir> --out <checkpointDir> [--label <text>]
  tsx scripts/rollback-checkpoint.ts verify --checkpoint <checkpointDir>
  tsx scripts/rollback-checkpoint.ts restore --checkpoint <checkpointDir> --target <dir> [--no-clean]
`);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  }

  try {
    if (command === "create") {
      const source = getArg("--source");
      const out = getArg("--out");
      const label = getArg("--label") || "cli-checkpoint";

      if (!source || !out) {
        console.error("Fehler: --source und --out sind erforderlich.");
        printUsage();
        process.exit(1);
      }

      const manifest = createCheckpoint(source, out, label);
      console.log(`Checkpoint erfolgreich angelegt in '${out}' (Label: ${manifest.label}):`);
      console.log(`  Dateien: ${manifest.fileCount}`);
      console.log(`  Gesamtgröße: ${manifest.totalSize} Bytes`);
      console.log(`  Aggregat-Hash: ${manifest.aggregateHash}`);
      console.log(`  DB-Hinweis: ${manifest.dbMigrationNotice}`);
    } else if (command === "verify") {
      const checkpoint = getArg("--checkpoint");
      if (!checkpoint) {
        console.error("Fehler: --checkpoint ist erforderlich.");
        printUsage();
        process.exit(1);
      }

      const res = verifyCheckpoint(checkpoint);
      if (res.valid && res.manifest) {
        console.log(`Checkpoint in '${checkpoint}' ist GÜLTIG.`);
        console.log(`  Label: ${res.manifest.label}`);
        console.log(`  Erstellt am: ${res.manifest.createdAt}`);
        console.log(`  Dateien: ${res.manifest.fileCount}`);
        console.log(`  Aggregat-Hash: ${res.manifest.aggregateHash}`);
      } else {
        console.error(`Checkpoint in '${checkpoint}' ist UNGÜLTIG:`);
        for (const err of res.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
    } else if (command === "restore") {
      const checkpoint = getArg("--checkpoint");
      const target = getArg("--target");
      const noClean = args.includes("--no-clean");

      if (!checkpoint || !target) {
        console.error("Fehler: --checkpoint und --target sind erforderlich.");
        printUsage();
        process.exit(1);
      }

      const res = restoreCheckpoint(checkpoint, target, { cleanTarget: !noClean });
      console.log(`Checkpoint '${res.label}' ERFOLGREICH nach '${target}' wiederhergestellt:`);
      console.log(`  Wiederhergestellte Dateien: ${res.restoredFiles}`);
      console.log(`  Bereinigte Dateien: ${res.cleanedFiles}`);
      console.log(`  Aggregat-Hash: ${res.aggregateHash}`);
    } else {
      console.error(`Unbekannter Befehl '${command}'.`);
      printUsage();
      process.exit(1);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Fehler bei Ausführung: ${msg}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
