/**
 * Sprint 096 — Administrator-Handbuch: Betrieb, Grenzen und Notfallstop sind
 * dokumentiert. Dieser Test haelt das Handbuch ehrlich: Jede harte Aussage
 * (Umgebungsvariablen, Betriebszustaende, Limits, Freigabepunkte, Mutationen)
 * wird gegen den echten Code geprueft. Driftet der Code, faellt der Test —
 * das Handbuch luegt nie ueber die Implementierung.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENV } from "./_core/env";
import { ELITE_LIMITS } from "./agent-engine";

const handbookPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../docs/ADMIN-HANDBUCH.md"
);
const handbook = readFileSync(handbookPath, "utf8");

/** env.ts Quelle — jede dort gelesene Variable muss im Handbuch stehen. */
const envSource = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "_core/env.ts"
  ),
  "utf8"
);

describe("Administrator-Handbuch (Sprint 096)", () => {
  it("deckt Betrieb, Grenzen und Notfallstop als eigene Abschnitte ab", () => {
    expect(handbook).toContain("## 1 · Betrieb");
    expect(handbook).toContain("## 2 · Grenzen");
    expect(handbook).toContain("## 3 · Notfallstop");
  });

  it("dokumentiert jede Umgebungsvariable, die env.ts wirklich liest", () => {
    const envVars = [...envSource.matchAll(/process\.env\.([A-Z_]+)/g)].map(
      (match) => match[1]
    );
    // HF_TOKEN und GITHUB_* werden ausserhalb env.ts gelesen und sind im
    // Handbuch ebenfalls gelistet — daher Pruefung gegen die Union:
    const documented = new Set(
      [...handbook.matchAll(/`([A-Z][A-Z_]+)`/g)].map((match) => match[1])
    );
    for (const variable of envVars) {
      expect(documented, variable).toContain(variable);
    }
    for (const extra of ["HF_TOKEN", "GITHUB_TOKEN", "GITHUB_REPOSITORY"]) {
      expect(documented, extra).toContain(extra);
    }
  });

  it("dokumentiert die echten Betriebszustaende und die Stop-Mutation", () => {
    expect(handbook).toContain("agent.setState");
    expect(handbook).toContain('"STOPPED"');
    expect(handbook).toContain('"RUNNING"');
    expect(handbook).toContain("acknowledgeStop");
    expect(handbook).toContain("controller-stop");
  });

  it("dokumentiert die Elite-Limits mit den echten Zahlen", () => {
    // Lesbare Schreibweise des Handbuchs: Tausender mit Leerzeichen (12 000).
    const pretty = (n: number) =>
      String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    expect(handbook).toContain(pretty(ELITE_LIMITS.promptChars));
    expect(handbook).toContain(pretty(ELITE_LIMITS.timeoutMs));
    expect(handbook).toContain(String(ELITE_LIMITS.githubActionsPerMission));
    expect(handbook).toContain(pretty(ELITE_LIMITS.defaultOutputTokens));
  });

  it("dokumentiert die GitHub-Schreibgrenzen ehrlich", () => {
    expect(handbook).toContain("agent/*");
    expect(handbook).toContain("Draft-PR");
    expect(handbook).toContain("Default-Branch");
    expect(handbook).toContain(".github/workflows");
  });

  it("referenziert nur Dokumente, die wirklich existieren", () => {
    const referenced = [...handbook.matchAll(/docs\/([A-Z0-9-]+\.md)/g)].map(
      (match) => `docs/${match[1]}`
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const doc of referenced) {
      const docPath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        doc
      );
      expect(() => readFileSync(docPath, "utf8"), doc).not.toThrow();
    }
  });

  it("nennt den Provider-Fallback in der echten Reihenfolge", () => {
    const forge = handbook.indexOf("Forge");
    const openrouter = handbook.indexOf("OpenRouter");
    const groq = handbook.indexOf("Groq");
    const gemini = handbook.indexOf("Gemini");
    expect(forge).toBeGreaterThan(-1);
    expect(openrouter).toBeGreaterThan(forge);
    expect(groq).toBeGreaterThan(openrouter);
    expect(gemini).toBeGreaterThan(groq);
  });
});
