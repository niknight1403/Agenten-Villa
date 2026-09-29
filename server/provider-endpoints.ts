/**
 * Single source of truth for provider endpoints.
 *
 * `OPENROUTER_BASE_URL` may point at a self-hosted gateway or a local test
 * double; the free-route guardian probes the same base so health checks and
 * real traffic never diverge.
 */
export const HUGGINGFACE_CHAT_URL =
  "https://router.huggingface.co/v1/chat/completions";
export const HUGGINGFACE_MODEL = "google/gemma-2-2b-it";

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
