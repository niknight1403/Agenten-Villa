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
