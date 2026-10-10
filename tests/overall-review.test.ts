/**
 * Sprint 099 — Gesamt- und Sicherheitsreview: automatisierter Nachweis,
 * dass jeder Bereich in docs/GESAMT-REVIEW.md mit "Grün" dokumentiert ist
 * und dass die referenzierten Testdateien real existieren. Zusaetzlich:
 * Geheimnis-Scan ueber den Quellcode (kein eingecheckter Provider-Key).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REVIEW_DOC = join(process.cwd(), "docs", "GESAMT-REVIEW.md");
const review = readFileSync(REVIEW_DOC, "utf8");

describe("Gesamt-Review ist dokumentiert (Sprint 099)", () => {
  it("jede Statuszeile der Matrix ist Grün", () => {
    const rows = review
      .split("\n")
      .filter(line => /^\| .+ \| Grün \|/.test(line));
    // Mindestens die 15 Bereiche der Matrix.
    expect(rows.length).toBeGreaterThanOrEqual(15);
    // Kein Bereich ist Rot/Gelb/Geplant dokumentiert.
    expect(review).not.toMatch(/\| (Rot|Gelb|Geplant) \|/);
  });

  it("jede referenzierte Testdatei existiert", () => {
    const testRefs = [...review.matchAll(/`([^`]+\.test\.ts)`/g)].map(m => m[1]);
    expect(testRefs.length).toBeGreaterThanOrEqual(15);
    const missing = testRefs.filter(ref => !existsSync(join(process.cwd(), ref)));
    expect(missing).toEqual([]);
  });

  it("jede referenzierte Doku existiert", () => {
    const docRefs = [
      ...review.matchAll(/`(docs\/[A-Za-z0-9\-_.]+)`/g),
    ].map(m => m[1]);
    expect(docRefs.length).toBeGreaterThanOrEqual(10);
    const missing = docRefs.filter(ref => !existsSync(join(process.cwd(), ref)));
    expect(missing).toEqual([]);
  });

  it("bewusste Einschraenkungen sind ehrlich benannt", () => {
    expect(review).toContain("keine Rot-Status");
  });
});

describe("Keine Geheimnisse im Quellcode (Sprint 099)", () => {
  const KEY_PATTERNS: Array<[RegExp, string]> = [
    [/gsk_[A-Za-z0-9]{20,}/, "Groq-API-Key"],
    [/sk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter-API-Key"],
    [/AIza[A-Za-z0-9_-]{30,}/, "Google-API-Key"],
    [/hf_[A-Za-z0-9]{20,}/, "HuggingFace-Token"],
  ];

  const SOURCE_DIRS = ["server", "client/src", "shared", "scripts", "tests"];

  it("enthaelt keine eingecheckten Provider-Keys", async () => {
    const { readdir, readFile, stat } = await import("node:fs/promises");

    async function collect(dir: string): Promise<string[]> {
      const files: string[] = [];
      let entries;
      try {
        entries = await readdir(join(process.cwd(), dir), { withFileTypes: true });
      } catch {
        return files;
      }
      for (const entry of entries) {
        if (entry.name.includes("node_modules") || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await collect(full)));
        else if (/\.(ts|tsx|mjs|js|json)$/.test(entry.name)) files.push(full);
      }
      return files;
    }

    const files = (await Promise.all(SOURCE_DIRS.map(collect))).flat();
    expect(files.length).toBeGreaterThan(50);

    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(join(process.cwd(), file), "utf8");
      for (const [pattern, label] of KEY_PATTERNS) {
        if (pattern.test(content)) violations.push(`${file}: ${label}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it(".env ist nicht versioniert, .env.example schon", async () => {
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toContain(".env");
    expect(existsSync(join(process.cwd(), ".env.example"))).toBe(true);
    const { execFileSync } = await import("node:child_process");
    const tracked = execFileSync("git", ["ls-files"], { cwd: process.cwd() })
      .toString()
      .split("\n");
    expect(tracked).not.toContain(".env");
  });
});
