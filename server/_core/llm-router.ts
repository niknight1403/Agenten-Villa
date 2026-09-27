// llm-router.ts
// Fallback-Logik: forge.manus.im → openrouter → groq → gemini
// Wird von llm.ts importiert

import { ENV } from "./env";

type ProviderName = "forge" | "openrouter" | "groq" | "gemini";

interface Provider {
  name: ProviderName;
  url: string;
  apiKey: () => string;
  model: string;
  authHeader: (key: string) => Record<string, string>;
}

const PROVIDERS: Provider[] = [
  {
    name: "forge",
    url: ENV.forgeApiUrl?.trim()
      ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
      : "https://forge.manus.im/v1/chat/completions",
    apiKey: () => ENV.forgeApiKey,
    model: "",
    authHeader: (key) => ({ authorization: `Bearer ${key}` }),
  },
  {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: () => ENV.openrouterApiKey,
    model: "mistralai/mistral-7b-instruct:free",
    authHeader: (key) => ({
      authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://agenten-villa.app",
      "X-Title": "Agenten-Villa",
    }),
  },
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: () => ENV.groqApiKey,
    model: "llama3-8b-8192",
    authHeader: (key) => ({ authorization: `Bearer ${key}` }),
  },
  {
    name: "gemini",
    url: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
    apiKey: () => ENV.geminiApiKey,
    model: "gemini-1.5-flash",
    authHeader: (_key) => ({}), // Key als Query-Param
  },
];

const COOLDOWNS = new Map<ProviderName, number>();
const COOLDOWN_MS = 5 * 60 * 1000;
const FAILOVER_STATUS = [402, 429, 503];

function isAvailable(p: Provider): boolean {
  const key = p.apiKey();
  if (!key) return false;
  const until = COOLDOWNS.get(p.name) ?? 0;
  return Date.now() > until;
}

function setCooldown(name: ProviderName) {
  COOLDOWNS.set(name, Date.now() + COOLDOWN_MS);
  console.warn(`[LLM-Router] ${name} → Cooldown für 5 min`);
}

export async function fetchWithFallback(
  payload: Record<string, unknown>,
  init: { method: string; headers: Record<string, string>; body: string }
): Promise<Response> {
  const available = PROVIDERS.filter(isAvailable);

  if (available.length === 0) {
    throw new Error("[LLM-Router] Alle Provider erschöpft oder nicht konfiguriert");
  }

  for (const provider of available) {
    const key = provider.apiKey();

    // Modell-Fallback: wenn kein Modell im Payload, Provider-Default nutzen
    const body = { ...payload };
    if (!body.model && provider.model) {
      body.model = provider.model;
    }

    const url =
      provider.name === "gemini"
        ? `${provider.url}?key=${key}`
        : provider.url;

    const headers = {
      "content-type": "application/json",
      ...provider.authHeader(key),
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (response.ok) {
        if (provider.name !== "forge") {
          console.log(`[LLM-Router] Aktiv: ${provider.name}`);
        }
        return response;
      }

      if (FAILOVER_STATUS.includes(response.status)) {
        setCooldown(provider.name);
        await response.body?.cancel().catch(() => {});
        console.warn(`[LLM-Router] ${provider.name} HTTP ${response.status} → weiter`);
        continue;
      }

      // Anderer Fehler (4xx/5xx) → trotzdem zurückgeben, Caller behandelt ihn
      return response;

    } catch (err) {
      console.warn(`[LLM-Router] ${provider.name} Netzwerkfehler → weiter`, err);
      continue;
    }
  }

  throw new Error("[LLM-Router] Alle Provider fehlgeschlagen");
}

export function assertAnyApiKey() {
  const hasKey = PROVIDERS.some((p) => !!p.apiKey());
  if (!hasKey) {
    throw new Error("Kein LLM-API-Key konfiguriert (BUILT_IN_FORGE_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY oder GEMINI_API_KEY)");
  }
}
