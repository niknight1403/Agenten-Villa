/**
 * Single source of truth for provider endpoints.
 *
 * `OPENROUTER_BASE_URL` may point at a self-hosted gateway or a local test
 * double; the free-route guardian probes the same base so health checks and
 * real traffic never diverge.
 */
export const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GEMINI_CHAT_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
export const HUGGINGFACE_CHAT_URL =
  "https://router.huggingface.co/v1/chat/completions";

/**
 * Default-Modellketten je Anbieter. Env-Overrides (GROQ_MODELS,
 * GEMINI_MODELS, HF_MODEL) erlauben Anpassung ohne Codeänderung. Die Defaults
 * sind auf Gratis-Verfügbarkeit und Tool-Fähigkeit gewählt.
 */
const DEFAULT_GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
] as const;
const DEFAULT_GEMINI_MODELS = ["gemini-3.8-flash"] as const;
export const DEFAULT_HUGGINGFACE_MODEL = "meta-llama/Llama-3.3-70B-Instruct";

function modelChain(
  raw: string | undefined,
  defaults: readonly string[]
): string[] {
  const configured = raw
    ?.split(",")
    .map(m => m.trim())
    .filter(Boolean) ?? [];
  return (configured.length > 0 ? configured : [...defaults]).slice(0, 6);
}

/**
 * Sprint 080 — lokale Ollama-Route: qwen3.6:27b / qwen3-coder:30b
 * (Coding-Experte), devstral:24b (Agenten-Spezialist) und gemma4:12b
 * (ressourcen-effizienter Allrounder) ersetzen auf eigener Hardware
 * kostenpflichtige Cloud-Modelle. Konfiguriert per OLLAMA_BASE_URL
 * (OpenAI-kompatibel, z. B. http://mein-host:11434/v1), Modelle per
 * OLLAMA_MODELS ueberschreibbar. Ohne Base-URL existiert die Route nicht.
 */
const DEFAULT_OLLAMA_MODELS = [
  "qwen3.6:27b",
  "qwen3-coder:30b",
  "devstral:24b",
  "gemma4:12b",
] as const;

export function ollamaModels(): string[] {
  return modelChain(process.env.OLLAMA_MODELS?.trim(), DEFAULT_OLLAMA_MODELS);
}

/**
 * Lokale Modelle sind langsamer als Cloud-APIs: 27B-Inferenz braucht
 * Minuten, keine Sekunden. OLLAMA_TIMEOUT_MS (Default 120 s, begrenzt
 * auf 600 s) gibt der Route ihr eigenes Zeitlimit — die Cloud-Routen
 * behalten das kurze Standardlimit.
 */
export function ollamaTimeoutMs(): number {
  const raw = Number(process.env.OLLAMA_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 120_000;
  return Math.min(Math.round(raw), 600_000);
}

function ollamaBase(): string | undefined {
  const base = process.env.OLLAMA_BASE_URL?.trim();
  return base ? trimBase(base) : undefined;
}

/** Ollama chat completions (OpenAI-kompatibler Endpunkt). */
export function ollamaChatUrl(): string {
  const base = ollamaBase();
  return base ? `${base}/chat/completions` : "";
}

/** Ollama-Modelliste — ungefährlicher Health-Probe ohne Verbrauch. */
export function ollamaModelsUrl(): string {
  const base = ollamaBase();
  return base ? `${base}/models` : "";
}

export function groqModels(): string[] {
  return modelChain(process.env.GROQ_MODELS?.trim(), DEFAULT_GROQ_MODELS);
}
export function geminiModels(): string[] {
  return modelChain(process.env.GEMINI_MODELS?.trim(), DEFAULT_GEMINI_MODELS);
}
export function hfModel(): string {
  return process.env.HF_MODEL?.trim() || DEFAULT_HUGGINGFACE_MODEL;
}

function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/** OpenRouter chat completions endpoint. */
export function openRouterChatUrl(): string {
  const base = process.env.OPENROUTER_BASE_URL?.trim();
  return base
    ? `${trimBase(base)}/chat/completions`
    : "https://openrouter.ai/api/v1/chat/completions";
}

/** OpenRouter model catalogue endpoint, used for free-route health probes. */
export function openRouterModelsUrl(): string {
  const base = process.env.OPENROUTER_BASE_URL?.trim();
  return base
    ? `${trimBase(base)}/models`
    : "https://openrouter.ai/api/v1/models";
}
