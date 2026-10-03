/**
 * Sprint 078 — Auto-Merge-Gate: die dokumentierte Ausnahme von
 * docs/BRANCH-PROTECTION.md (Beschluss des Owners vom 03.10.2026):
 * Pull Requests aus agent/*-Branches werden automatisch per Squash
 * gemerged, sobald ALLE Pflichtchecks gruen sind.
 *
 * Sicherheitsregeln (bewusst konservativ):
 *  - nur agent/* -> main
 *  - nie fuer PRs, die .github/, diese Regeln selbst oder die
 *    Branch-Schutz-Dokumentation aendern (Admin-Disziplin bleibt)
 *  - alle Checks muessen abgeschlossen und gruen sein; ausstehende
 *    Checks blockieren (der naechste workflow_run triggert erneut)
 *  - Sprint 081: ein Pflichtcheck, dessen Workflow laut Pfadfilter bei
 *    diesen geaenderten Dateien gar nicht haette triggern koennen, gilt
 *    als erfullet (Server-only-PRs ohne Android-Smoke werden nicht
 *    ewig blockiert). Haette er triggern koennen, bleibt er Pflicht.
 *
 * Das Modul ist rein: der Workflow uebergibt die gesammelten Fakten als
 * JSON, hier wird nur entschieden. Der Workflow laedt die Regeln vom
 * Default-Branch — ein PR kann seine eigene Freigabe nicht umbiegen.
 */

export type MergeGateInput = {
  branch: string;
  state: string;
  isDraft: boolean;
  base: string;
  changedFiles: string[];
  checks: Array<{ name: string; conclusion: string | null }>;
};

export type MergeGateDecision = {
  merge: boolean;
  reason: string;
};

/** Pflichtchecks: muessen vorhanden UND erfolgreich sein. */
export const REQUIRED_CHECKS: readonly string[] = [
  "CI",
  "PR Agent (Gemini)",
  "Android mobile smoke",
];

/** Zulaessige, nicht blockierende Check-Ergebnisse neben success. */
const NON_BLOCKING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/**
 * Sprint 081 — Trigger-Pfade der pfadgefilterten Pflichtchecks (Spiegel
 * der `paths:`-Filter der Workflows). Ein fehlender Check gilt nur dann
 * als erfuellt, wenn KEINE geaenderte Datei diese Pfade beruehrt; sonst
 * muesste er laufen und sein Fehlen blockiert weiter.
 * Endet ein Eintrag mit "/", ist er ein Verzeichnis-Prefix, sonst ein
 * exakter Dateipfad.
 */
export const PATH_FILTERED_CHECKS: Record<string, readonly string[]> = {
  "Android mobile smoke": [
    "android/",
    "client/",
    "capacitor.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/android-smoke.yml",
  ],
};

/** Prueft, ob eine geaenderte Datei den Pfadfilter eines Checks beruehrt. */
export function checkCouldTrigger(
  checkName: string,
  changedFiles: readonly string[]
): boolean {
  const paths = PATH_FILTERED_CHECKS[checkName];
  if (!paths) return true; // kein Filter bekannt: Check ist immer Pflicht
  return changedFiles.some(file =>
    paths.some(pattern =>
      pattern.endsWith("/")
        ? file.startsWith(pattern)
        : file === pattern
    )
  );
}

/** Pfade, deren Aenderung immer Admin-Disziplin (manueller Merge) verlangt. */
export function isProtectedPath(filePath: string): boolean {
  if (filePath.startsWith(".github/")) return true;
  if (filePath === "docs/BRANCH-PROTECTION.md") return true;
  if (filePath === "server/auto-merge-gate.ts") return true;
  return false;
}

function normalize(conclusion: string | null): string {
  return (conclusion ?? "").toLowerCase();
}

export function evaluateMergeGate(input: MergeGateInput): MergeGateDecision {
  if (input.state.toUpperCase() !== "OPEN")
    return { merge: false, reason: `PR ist ${input.state}, nicht offen` };
  if (input.isDraft)
    return { merge: false, reason: "PR ist ein Draft" };
  if (input.base !== "main")
    return { merge: false, reason: `Ziel-Branch ist ${input.base}, nicht main` };
  if (!input.branch.startsWith("agent/"))
    return {
      merge: false,
      reason: `Branch ${input.branch} ist kein agent/*-Branch`,
    };

  const protectedFile = input.changedFiles.find(isProtectedPath);
  if (protectedFile)
    return {
      merge: false,
      reason: `Geschuetzter Pfad geaendert: ${protectedFile} (Admin-Entscheidung noetig)`,
    };

  const byName = new Map<string, string>();
  for (const check of input.checks)
    byName.set(check.name, normalize(check.conclusion));

  const pending = input.checks.filter(
    check => check.conclusion === null || check.conclusion === ""
  );
  if (pending.length > 0)
    return {
      merge: false,
      reason: `Checks laufen noch: ${pending.map(c => c.name).join(", ")}`,
    };

  for (const [name, conclusion] of Array.from(byName.entries())) {
    if (!NON_BLOCKING_CONCLUSIONS.has(conclusion))
      return { merge: false, reason: `Check ${name} ist ${conclusion || "unbekannt"}` };
  }

  for (const required of REQUIRED_CHECKS) {
    const conclusion = byName.get(required);
    if (conclusion === undefined) {
      // Sprint 081 — fehlt der Check, weil sein Workflow laut Pfadfilter
      // bei diesen Dateien gar nicht triggert, gilt er als erfuellt;
      // sonst blockiert sein Fehlen weiter (er muesste ja laufen).
      if (!checkCouldTrigger(required, input.changedFiles)) continue;
      return { merge: false, reason: `Pflichtcheck ${required} fehlt noch` };
    }
    if (conclusion !== "success")
      return {
        merge: false,
        reason: `Pflichtcheck ${required} ist ${conclusion}, nicht success`,
      };
  }

  return {
    merge: true,
    reason: "Offener agent/*-PR auf main mit allen Pflichtchecks gruen",
  };
}

// ---------------------------------------------------------------------------
// CLI: Fakten-JSON einlesen, Entscheidung ausgeben (fuer den Workflow).
// Beim Import in Tests laeuft dieser Teil bewusst nicht.
// ---------------------------------------------------------------------------
if (process.argv[2] === "--input") {
  const filePath = process.argv[3];
  if (!filePath) {
    console.error("Nutzung: auto-merge-gate.ts --input <facts.json>");
    process.exit(2);
  }
  // Spater Import, damit das Modul in Tests importierbar bleibt.
  import("node:fs")
    .then(fs => {
      const input = JSON.parse(
        fs.readFileSync(filePath, "utf8")
      ) as MergeGateInput;
      console.log(JSON.stringify(evaluateMergeGate(input)));
    })
    .catch(error => {
      console.error("Fakten konnten nicht gelesen werden:", error);
      process.exit(2);
    });
}
