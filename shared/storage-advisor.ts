/**
 * Sprint 053 — Speicher-Berater: gemeinsame Schemata fuer den intelligenten
 * Handy-Speicher-Manager-Agenten.
 *
 * Datensparsamkeit ist Teil des Designs: Der Client sendet NUR anonymisierte
 * Statistiken (Kategorien, Groessen- und Altersklassen) an den Server.
 * Dateinamen und Pfade verlassen das Geraet nie; der Berater antwortet mit
 * Regeln (Filtern), die der Client lokal gegen die echten Eintraege anwendet.
 */
import { z } from "zod";

export const CATEGORIES = ["Bilder", "Videos", "Audio", "Dokumente", "Archive", "Andere"] as const;

/** Anonymisierte Kategorie-Statistik ohne Namen, Pfade oder Inhalte. */
export const advisorCategoryStatSchema = z.object({
  category: z.enum(CATEGORIES),
  count: z.number().int().min(0).max(100_000),
  bytes: z.number().int().min(0),
  /** Anteil der Dateien, die aelter als 180 Tage sind (0..1). */
  oldRatio: z.number().min(0).max(1),
  /** Anzahl Dateien ueber 100 MB. */
  over100MB: z.number().int().min(0).max(100_000),
  /** Anzahl Dateien ueber 1 GB. */
  over1GB: z.number().int().min(0).max(100_000),
});

export const advisorStatsSchema = z.object({
  totalFiles: z.number().int().min(0).max(100_000),
  totalBytes: z.number().int().min(0),
  /** Anzahl Verzeichnisse im gewaehlten Ordner. */
  directories: z.number().int().min(0).max(100_000),
  categories: z.array(advisorCategoryStatSchema).max(CATEGORIES.length),
});

export type AdvisorStats = z.infer<typeof advisorStatsSchema>;
export type AdvisorCategoryStat = z.infer<typeof advisorCategoryStatSchema>;

/**
 * Regel-Filter des Beraters. Eine Delete-Regel benoetigt MINDESTENS EIN
 * Kriterium (category | minSizeMB | olderThanDays | top) — sonst wird sie
 * verworfen. "Alles loeschen" ist als KI-Antwort bewusst unmoeglich.
 */
export const advisorRuleSchema = z.object({
  operation: z.enum(["delete", "move"]),
  category: z.enum(CATEGORIES).optional(),
  minSizeMB: z.number().min(0).max(1_000_000).optional(),
  olderThanDays: z.number().int().min(1).max(36_500).optional(),
  /** Maximale Anzahl betroffener Dateien (die groessten zuerst). */
  top: z.number().int().min(1).max(500).optional(),
  reason: z.string().max(400).optional(),
});

export const advisorAnswerSchema = z.object({
  summary: z.string().max(600),
  rules: z.array(advisorRuleSchema).max(10),
});

export type AdvisorRule = z.infer<typeof advisorRuleSchema>;
export type AdvisorAnswer = z.infer<typeof advisorAnswerSchema>;

/** Volltext der LLM-Antwort -> validierte, begrenzte, gefilterte Regeln. */
export function parseAdvisorAnswer(raw: string): AdvisorAnswer {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("ADVISOR_NO_JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("ADVISOR_INVALID_JSON");
  }
  const result = advisorAnswerSchema.safeParse(parsed);
  if (!result.success) throw new Error("ADVISOR_SCHEMA_INVALID");
  const safe: AdvisorAnswer = {
    summary: result.data.summary,
    rules: result.data.rules.filter(rule => {
      if (rule.operation === "delete") {
        const hasFilter = rule.category !== undefined || rule.minSizeMB !== undefined
          || rule.olderThanDays !== undefined;
        return hasFilter; // ungefilterte Delete-Regeln ("alles loeschen") fallen.
      }
      return true;
    }),
  };
  return safe;
}
