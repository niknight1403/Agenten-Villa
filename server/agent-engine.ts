export type Provider = "openrouter" | "huggingface";
export type Message = { role: "user" | "assistant"; content: string };
export type AgentInput = { prompt: string; history: Message[]; mode: "home" | "workshop"; specialty: string };
export type AgentResult = { answer: string; provider: Provider; model: string; attempts: number };

export class AgentError extends Error {
  constructor(public readonly code: "MISSING_KEY" | "LIMIT" | "AUTH" | "UNAVAILABLE" | "REJECTED" | "STOPPED" | "INVALID_RESPONSE", message: string, public readonly status?: number) {
    super(message);
    this.name = "AgentError";
  }
}

export const LIMITS = { promptChars: 4_000, historyMessages: 8, historyChars: 1_000, outputTokens: 384, timeoutMs: 15_000, maxCalls: 2 } as const;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const HUGGINGFACE_URL = "https://router.huggingface.co/v1/chat/completions";
const HF_MODEL = "google/gemma-2-2b-it";
const SYSTEM = "Du bist der Agenten-Villa-Assistent. Erledige genau einen begrenzten Zyklus: planen, transformieren, prüfen und einmal verbessern. Behaupte nicht, Dateien geändert, Tests ausgeführt, Repositories gelesen oder externe Werkzeuge verwendet zu haben. Hier gibt es keinen GitHub- oder Shell-Zugriff. Liefere Vorschläge statt behaupteter Aktionen. Keine Endlosschleifen.";

type Completion = { model?: string; choices?: Array<{ message?: { content?: string | null } }> };
type Dependencies = { fetcher?: typeof fetch; beforeFallback?: () => Promise<boolean> };

function retryable(status: number) { return [408, 429, 500, 502, 503, 504].includes(status); }

function makeMessages(input: AgentInput) {
  const context = input.mode === "workshop"
    ? "Projekt-Werkstatt: Nutze nur Angaben aus dem Nutzerprompt; kein Repository-Zugriff."
    : `Agenten-Villa: Unterstütze den Bereich ${input.specialty.slice(0, 80)}.`;
  return [
    { role: "system", content: `${SYSTEM}\n\n${context}` },
    ...input.history.slice(-LIMITS.historyMessages).map((m) => ({ role: m.role, content: m.content.slice(0, LIMITS.historyChars) })),
    { role: "user", content: input.prompt.trim().slice(0, LIMITS.promptChars) },
  ];
}

async function callProvider(fetcher: typeof fetch, url: string, key: string, model: string, input: AgentInput) {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: makeMessages(input), max_tokens: LIMITS.outputTokens, temperature: 0.4, stream: false }),
      signal: AbortSignal.timeout(LIMITS.timeoutMs),
    });
  } catch {
    throw new AgentError("UNAVAILABLE", "Der Modellanbieter ist momentan nicht erreichbar.");
  }
  if (response.status === 402 || response.status === 429) throw new AgentError("LIMIT", "Das Kontingent oder Anfragelimit des Anbieters ist erreicht.", response.status);
  if (response.status === 401 || response.status === 403) throw new AgentError("AUTH", "Der Anbieterschlüssel ist ungültig oder nicht berechtigt.", response.status);
  if (retryable(response.status)) throw new AgentError("UNAVAILABLE", "Der Modellanbieter ist vorübergehend nicht verfügbar.", response.status);
  if (!response.ok) throw new AgentError("REJECTED", "Der Modellanbieter hat die Anfrage abgelehnt.", response.status);
  let data: Completion;
  try { data = await response.json() as Completion; }
  catch { throw new AgentError("INVALID_RESPONSE", "Der Modellanbieter lieferte keine lesbare Antwort."); }
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new AgentError("INVALID_RESPONSE", "Der Modellanbieter lieferte eine leere Antwort.");
  return { answer: answer.slice(0, 20_000), model: (data.model || model).slice(0, 120) };
}

export async function runAgentTurn(input: AgentInput, allowFallback: boolean, deps: Dependencies = {}): Promise<AgentResult> {
  const primaryKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!primaryKey) throw new AgentError("MISSING_KEY", "Der OpenRouter-Schlüssel ist noch nicht sicher eingerichtet.");
  const fetcher = deps.fetcher ?? fetch;
  try {
    const result = await callProvider(fetcher, OPENROUTER_URL, primaryKey, "openrouter/free", input);
    return { ...result, provider: "openrouter", attempts: 1 };
  } catch (error) {
    // Never use a second provider after exhausted credits/rate quota or invalid credentials.
    if (!allowFallback || !(error instanceof AgentError) || error.code !== "UNAVAILABLE") throw error;
    const hfKey = process.env.HF_TOKEN?.trim();
    if (!hfKey) throw new AgentError("MISSING_KEY", "Der optionale Hugging-Face-Fallback hat keinen Server-Schlüssel.");
    if (deps.beforeFallback && !(await deps.beforeFallback())) throw new AgentError("STOPPED", "Der Agent wurde vor dem optionalen Fallback gestoppt.");
    const result = await callProvider(fetcher, HUGGINGFACE_URL, hfKey, HF_MODEL, input);
    return { ...result, provider: "huggingface", attempts: 2 };
  }
}

export function safeAgentError(error: unknown) {
  return error instanceof AgentError ? error.message : "Der Agent konnte die Anfrage gerade nicht abschließen.";
}

export function validAgentInput(input: AgentInput) {
  return Boolean(input.prompt.trim()) && input.prompt.length <= LIMITS.promptChars &&
    (input.mode === "home" || input.mode === "workshop") && Array.isArray(input.history) &&
    input.history.length <= 20 && input.history.every((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
}

export function validRating(value: number): value is -1 | 1 { return value === -1 || value === 1; }
export function isRetryableStatus(status: number) { return retryable(status); }
export function isFallbackEligible(status: number, optedIn: boolean) { return optedIn && retryable(status) && status !== 429; }
export function configuredProviders() { return { openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()), huggingface: Boolean(process.env.HF_TOKEN?.trim()) }; }

export type OpenRouterKeyStatus = "valid" | "invalid" | "unavailable";
export async function verifyOpenRouterKey(key: string, fetcher: typeof fetch = fetch): Promise<OpenRouterKeyStatus> {
  try {
    const response = await fetcher("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 200) return "valid";
    if (response.status === 401 || response.status === 403) return "invalid";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export const PROVIDER_NOTICE = "Gratisverfügbarkeit und Kontingente werden von den Anbietern festgelegt und können sich ändern. Bei erreichtem Limit wird gestoppt; es erfolgt keine bezahlte oder rotierende Ausweichroute. Hugging Face wird nur bei ausdrücklicher Einwilligung und vorübergehendem Ausfall versucht.";
export const PROVIDER_DOCS = { openrouter: "https://openrouter.ai/docs/guides/routing/routers/free-router", huggingface: "https://huggingface.co/docs/inference-providers/en/pricing" } as const;
