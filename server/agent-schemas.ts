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
  historyChars: 1_000,
  specialtyChars: 60,
  systemOverrideChars: 4_000,
} as const;

export const LIMITS_SCHEMA = AGENT_INPUT_LIMITS;

/** Kontext: einzelne Verlaufsnachricht mit Rolle und begrenztem Inhalt. */
export const agentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(LIMITS_SCHEMA.historyChars),
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
    provider: z.enum(["openrouter", "groq", "gemini", "huggingface"]),
    model: z.string().min(1),
    attempts: z.number().int().min(0),
    githubActions: z.number().int().min(0).optional(),
    cached: z.boolean().optional(),
});

export type ValidAgentInput = z.infer<typeof agentInputSchema>;
export type ValidAgentResult = z.infer<typeof agentResultSchema>;

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
