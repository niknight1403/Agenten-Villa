/**
 * Sprint 053 — Server-Seite des Speicher-Beraters.
 *
 * Der Berater ist ein schmaler Agent-Pfad auf der bestehenden Multi-Provider-
 * Kette (OpenRouter -> Groq -> Gemini, mit Cache und Dedupe aus runAgentTurn):
 * Er sieht NUR die anonymisierten Statistiken aus shared/storage-advisor und
 * den Nutzer-Prompt. Dateinamen und Pfade erreichen den Server nie.
 */
import type { AgentResult } from "./agent-engine";
import { runAgentTurn } from "./agent-engine";
import {
  advisorStatsSchema,
  parseAdvisorAnswer,
  type AdvisorAnswer,
  type AdvisorStats,
} from "@shared/storage-advisor";

const ADVISOR_SYSTEM = [
  "Du bist der Speicher-Berater der Agenten Villa, ein praeziser Assistent fuer Handy-Speicher-Optimierung.",
  "Du erhaeltst ausschliesslich anonymisierte Statistiken eines vom Nutzer freigegebenen Ordners: Kategorien, Dateianzahlen, Groessen, Altersklassen. Keine Dateinamen, keine Pfade, keine Inhalte.",
  "Deine Aufgabe: Vorschlaege zum Freigeben von Speicherplatz und zum Ordnern, formuliert als Regeln, die das Geraet lokal anwendet.",
  "Antworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt, kein Markdown, kein Begleittext:",
  '{"summary":"kurze Erklaerung auf Deutsch (max. 2 Saetze)","rules":[{"operation":"delete"|"move","category":"Bilder|Videos|Audio|Dokumente|Archive|Andere" (optional),"minSizeMB":0 (optional),"olderThanDays":1 (optional),"top":1-500 (optional),"reason":"kurze Begruendung"}]}',
  "Harte Grenzen:",
  "- Eine delete-Regel benoetigt immer mindestens EIN Filterkriterium (category, minSizeMB oder olderThanDays). Regeln ohne Kriterium werden verworfen.",
  "- Weise in summary darauf hin, dass jede Loeschung vom Nutzer vor der Ausfuehung bestaetigt wird.",
  "- Nutze top, um Regeln praktikabel zu halten (z. B. die 10 groessten Videos).",
  "- Wenn die Statistiken nichts Sinnvolles ergeben, gib eine leere rules-Liste zurueck.",
].join("\n");

export function buildStorageAdvisorPrompt(prompt: string, stats: AdvisorStats): string {
  const lines = stats.categories.map(stat =>
    `- ${stat.category}: ${stat.count} Dateien, ${(stat.bytes / 1024 ** 2).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB, ${Math.round(stat.oldRatio * 100)} % aelter als 180 Tage, ${stat.over100MB} ueber 100 MB, ${stat.over1GB} ueber 1 GB`,
  );
  return [
    `Nutzer-Auftrag: ${prompt}`,
    "",
    "Anonymisierte Ordner-Statistik (keine Dateinamen):",
    `Gesamt: ${stats.totalFiles} Dateien, ${(stats.totalBytes / 1024 ** 2).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB in ${stats.directories} Verzeichnissen.`,
    ...lines,
  ].join("\n");
}

export type StorageAdvisorResult = AdvisorAnswer & {
  provider: AgentResult["provider"];
  model: string;
};

export async function runStorageAdvisor(
  input: { prompt: string; stats: unknown },
  deps: Parameters<typeof runAgentTurn>[2] = {}
): Promise<StorageAdvisorResult> {
  const prompt = input.prompt.trim().slice(0, 500);
  if (!prompt) throw new Error("ADVISOR_EMPTY_PROMPT");
  const parsedStats = advisorStatsSchema.safeParse(input.stats);
  if (!parsedStats.success) throw new Error("ADVISOR_STATS_INVALID");

  const result = await runAgentTurn(
    {
      prompt: buildStorageAdvisorPrompt(prompt, parsedStats.data),
      history: [],
      mode: "home",
      specialty: "Handy-Speicher",
      systemOverride: ADVISOR_SYSTEM,
      missionId: "storage-advisor",
    },
    true,
    deps
  );
  const answer = parseAdvisorAnswer(result.answer);
  return { ...answer, provider: result.provider, model: result.model };
}
