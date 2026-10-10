// llm-router.ts
// Fallback-Logik: forge.manus.im → openrouter → groq → gemini
// Wird von llm.ts importiert
//
// Sprint 095 — Erweiterungspunkte: Der Router ist eine REGISTRY. Neue
// Provider werden per registerLLMProvider() angemeldet — reine Daten,
// kein Kernumbau. Namens-Sonderfaelle (Query-Key, stilles Logging) sind
// als Provider-Hooks (buildUrl, quiet) modelliert, nicht als
// hartkodierte Namen im Fallback-Loop.

import { ENV } from "./env";

export interface LLMProvider {
  /** Eindeutiger Name (Kleinbuchstaben). Bestehende Namen werden ersetzt. */
  name: string;
  url: string;
  apiKey: () => string;
  /** Default-Modell, wenn der Payload keins mitbringt. */
  model: string;
  authHeader: (key: string) => Record<string, string>;
  /** Optional: eigene URL-Konstruktion (z. B. Key als Query-Parameter). */
  buildUrl?: (key: string) => string;
  /** Optional: Erfolgsmeldung im Log unterdruecken. */
  quiet?: boolean;
}

const DEFAULT_PROVIDERS: LLMProvider[] = [
  {
    name: "forge",
    url: ENV.forgeApiUrl?.trim()
      ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
      : "https://forge.manus.im/v1/chat/completions",
    apiKey: () => ENV.forgeApiKey,
    model: "",
    authHeader: (key) => ({ authorization: `Bearer ${key}` }),
    quiet: true,
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
    buildUrl: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${key}`,
  },
];

/** Die aktive Provider-Liste: Defaults + spaeter Angemeldete, in Reihenfolge. */
let registeredProviders: LLMProvider[] = [...DEFAULT_PROVIDERS];

/**
 * Sprint 095 — Erweiterungspunkt: meldet einen (oder aktualisiert einen
 * gleichnamigen) Provider an. Der Fallback-Loop braucht KEINE Anpassung.
 */
export function registerLLMProvider(provider: LLMProvider): void {
  const index = registeredProviders.findIndex(
    (existing) => existing.name === provider.name
  );
  if (index >= 0) {
    registeredProviders[index] = provider;
  } else {
    registeredProviders.push(provider);
  }
}

/** Nur fuer Tests: Registry auf die Default-Provider zuruecksetzen. */
export function resetLLMProvidersForTests(): void {
  registeredProviders = [...DEFAULT_PROVIDERS];
  COOLDOWNS.clear();
}

const COOLDOWNS = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000;
const FAILOVER_STATUS = [402, 429, 503];

function isAvailable(p: LLMProvider): boolean {
  const key = p.apiKey();
  if (!key) return false;
  const until = COOLDOWNS.get(p.name) ?? 0;
  return Date.now() > until;
}

function setCooldown(name: string) {
  COOLDOWNS.set(name, Date.now() + COOLDOWN_MS);
  console.warn(`[LLM-Router] ${name} → Cooldown für 5 min`);
}

export async function fetchWithFallback(
  payload: Record<string, unknown>,
  init: { method: string; headers: Record<string, string>; body: string }
): Promise<Response> {
  const available = registeredProviders.filter(isAvailable);

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

    const url = provider.buildUrl ? provider.buildUrl(key) : provider.url;

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
        if (!provider.quiet) {
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
  const hasKey = registeredProviders.some((p) => !!p.apiKey());
  if (!hasKey) {
    throw new Error("Kein LLM-API-Key konfiguriert (BUILT_IN_FORGE_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY oder GEMINI_API_KEY)");
  }
}
