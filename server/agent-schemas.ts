/**
 * Sprint 041 — Agentenauftragsschema: Eingaben, Kontext und Ergebnis
 * besitzen validierte Schemas. Ein Ort, eine Wahrheit: Die Zod-Schemas sind
 * die einzige Definition; Typen werden abgeleitet, die Engine prueft an
 * ihren Grenzen (Eingabe vor Verarbeitung, Ergebnis vor Rueckgabe).
 */
import { z } from "zod";
import { forgeOptionsSchema } from "../shared/forge";

/**
 * Eine Quelle der Wahrheit für die Eingabe-/Kontextgrenzen: Die Engine leitet
 * ihre LIMITS daraus ab (agent-engine importiert dieses Modul, nie umgekehrt).
 */
export const AGENT_INPUT_LIMITS = {
  promptChars: 4_000,
  historyMessages: 8,
  // Modell-Kontextbudget: so viele Zeichen je Verlaufsnachricht baut die
  // Engine tatsächlich in den Prompt an das (kostenlose) Modell ein
  // (agent-engine.ts: makeMessages kuerzt hiermit, Elite nutzt sein eigenes,
  // groesseres Budget). Bewusst klein gehalten, kostet keine zusaetzlichen
  // Token/Kosten in der Free-Tier-Kette.
  historyChars: 1_000,
  // Validierungsobergrenze je Verlaufsnachricht — unabhaengig vom obigen
  // Kontextbudget. Eine normale Konversation enthaelt oft vorherige
  // Assistenten-Antworten, die laenger als das Kontextbudget sind; die
  // Engine kuerzt sie dort ohnehin sicher. Die Eingabevalidierung darf das
  // nicht vorher hart ablehnen (das blockierte zuvor jede Fortsetzung einer
  // Konversation mit "Ungültiger Agenten-Auftrag (history.N.content): Too
  // big ..."), bleibt aber als Obergrenze gegen missbräuchlich große
  // Payloads bestehen.
  historyMessageMaxChars: 20_000,
  specialtyChars: 60,
  systemOverrideChars: 4_000,
} as const;

export const LIMITS_SCHEMA = AGENT_INPUT_LIMITS;

/** Kontext: einzelne Verlaufsnachricht mit Rolle und begrenztem Inhalt. */
export const agentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(LIMITS_SCHEMA.historyMessageMaxChars),
});

/** Kontext: begrenzter Verlauf, Reihenfolge bleibt erhalten. */
export const agentHistorySchema = z.array(agentMessageSchema).max(LIMITS_SCHEMA.historyMessages);

/** Eingabe: ein Agenten-Auftrag mit Prompt, Kontext und Modus. */
export const agentInputSchema = z
  .object({
    prompt: z.string().trim().min(1).max(LIMITS_SCHEMA.promptChars),
    history: agentHistorySchema,
    mode: z.enum(["home", "workshop"]),
    specialty: z.string().trim().min(1).max(LIMITS_SCHEMA.specialtyChars),
    /** Optionaler Administratoren-Persona-Ersatz; null bleibt null. */
    systemOverride: z.string().max(LIMITS_SCHEMA.systemOverrideChars).nullable().optional(),
    /** Persistierter, strukturierter Missionskontext (Elite). */
    forge: forgeOptionsSchema.optional(),
    /** Sprint 044 — Aufgaben-Identität: isoliert Cache und Dedupe pro Mission. */
    missionId: z.string().trim().min(1).max(80).optional(),
  });

/** Ergebnis: ein Agenten-Turn mit Antwort, Anbieter und Versuchen. */
export const agentResultSchema = z
  .object({
    answer: z.string().min(1),
    provider: z.enum([
      // Sprint 080 — ollama: lokale, kostenlose Route.
      "ollama",
      "openrouter",
      "groq",
      "gemini",
      "huggingface",
    ]),
    model: z.string().min(1),
    attempts: z.number().int().min(0),
    githubActions: z.number().int().min(0).optional(),
    cached: z.boolean().optional(),
    // Sprint 103 — Token-Nutzung des Turns (fuer die SaaS-Abrechnung).
    usage: z
      .object({
        promptTokens: z.number().min(0),
        completionTokens: z.number().min(0),
        totalTokens: z.number().min(0),
      })
      .optional(),
});

export type ValidAgentInput = z.infer<typeof agentInputSchema>;
export type ValidAgentResult = z.infer<typeof agentResultSchema>;

/**
 * Sprint 046 — Ergebnisvalidierung: Ergebnis der begrenzten GitHub-
 * Werkzeugrunde. Ungueltige Ergebnisse werden sicher abgewiesen, statt
 * unstrukturierte Daten an den Aufrufer oder die Persistenz weiterzureichen.
 */
export const toolLoopResultSchema = agentResultSchema.extend({
  completed: z.boolean(),
  pullRequestOpened: z.boolean(),
  pullRequest: z
    .object({
      number: z.number().int().positive(),
      url: z.string().url(),
      branch: z.string().min(1),
    })
    .nullable(),
  branch: z.string().min(1).nullable(),
});

export type ValidToolLoopResult = z.infer<typeof toolLoopResultSchema>;

/**
 * Prueft eine Eingabe gegen das Schema und wirft bei Verstoß einen
 * AgentError-artigen Fehler mit Fehlercode INVALID_INPUT (die Engine
 * mappend diesen auf BAD_REQUEST).
 */
export class AgentSchemaError extends Error {
  readonly code = "INVALID_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "AgentSchemaError";
  }
}

export function parseAgentInput(input: unknown): ValidAgentInput {
  const result = agentInputSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AgentSchemaError(
      `Ungültiger Agenten-Auftrag (${first?.path.join(".") ?? "Eingabe"}): ${first?.message ?? "Schema verletzt."}`
    );
  }
  return result.data;
}

/** Sprint 046 — validiert ein Werkzeugrunden-Ergebnis fail-closed. */
export function parseToolLoopResult(result: unknown): ValidToolLoopResult {
  const parsed = toolLoopResultSchema.safeParse(result);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AgentSchemaError(
      `Ungültiges Werkzeugrunden-Ergebnis (${first?.path.join(".") ?? "Ergebnis"}): ${first?.message ?? "Schema verletzt."}`
    );
  }
  return parsed.data;
}

export function parseAgentResult(result: unknown): ValidAgentResult {
  const parsed = agentResultSchema.safeParse(result);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AgentSchemaError(
      `Ungültiges Agenten-Ergebnis (${first?.path.join(".") ?? "Ergebnis"}): ${first?.message ?? "Schema verletzt."}`
    );
  }
  return parsed.data;
}

/** Bestehende, boolesche Pruefung — delegiert an das Schema. */
export function isValidAgentInput(input: unknown): boolean {
  return agentInputSchema.safeParse(input).success;
}
