/**
 * Sprint 102 — API-Routen-Rotator (Zero-Cost, Ollama-first).
 *
 * Der Rotator ordnet die freien LLM-Routen der Villa nach Gesundheit:
 * Der eigene Ollama-Host auf Oracle Cloud Always Free steht bewusst an
 * erster Stelle — selbst gehostet bedeutet keine Token-Abrechnung, keine
 * Rate-Limits und damit faktisch unbegrenzte Inferenz fuer den
 * Administrator (nur durch die Hardware der VM begrenzt). Cloud-Routen
 * mit freiem Kontingent (OpenRouter Free, Groq, Gemini, Hugging Face)
 * springen als Fallback ein, wenn die eigene Route gerade nicht antwortet.
 *
 * Nach jedem Tick wird die Reihenfolge in den LLM-Router uebernommen
 * (setRegisteredProviderOrder), sodass der Fallback-Loop genau in der
 * Rangfolge probiert. Der Administrator kann eine Route pinnen.
 */

import { checkProviderHealth, type ProviderHealthResult } from "./provider-health";
import type { ProviderName } from "./provider-registry";
import { setRegisteredProviderOrder } from "./_core/llm-router";

export type RouteName = ProviderName;

/** Rangliste: niedrigere Zahl = hoehere Prioritaet. Ollama-first. */
export const ROUTE_PRIORITY: readonly RouteName[] = [
  "ollama",
  "openrouter",
  "groq",
  "gemini",
  "huggingface",
] as const;

/** Alle Routen sind kostenlos; Ollama ist zusaetzlich unbegrenzt. */
export const ROUTE_PROFILE: Record<RouteName, { cost: "unlimited" | "free"; note: string }> = {
  ollama: { cost: "unlimited", note: "Eigener Host (Oracle Always Free) — keine Token-Abrechnung, keine Rate-Limits." },
  openrouter: { cost: "free", note: "Freie Modelle mit Tageskontingent." },
  groq: { cost: "free", note: "Freies Kontingent mit Rate-Limits." },
  gemini: { cost: "free", note: "Freies Kontingent mit Rate-Limits." },
  huggingface: { cost: "free", note: "Freie Inferenz, einwilligungsgated." },
};

export type RouteHealthStatus = "ok" | "invalid" | "not_configured" | "consent_required" | "unreachable";

type RotatorState = {
  lastResults: Record<RouteName, ProviderHealthResult & { at: number } | null>;
  activeRoute: RouteName | null;
  pinnedRoute: RouteName | null;
  lastTickAt: number;
};

const state: RotatorState = {
  lastResults: { ollama: null, openrouter: null, groq: null, gemini: null, huggingface: null },
  activeRoute: null,
  pinnedRoute: null,
  lastTickAt: 0,
};

export function resetRouteRotatorForTests(): void {
  state.lastResults = { ollama: null, openrouter: null, groq: null, gemini: null, huggingface: null };
  state.activeRoute = null;
  state.pinnedRoute = null;
  state.lastTickAt = 0;
}

export function pinRoute(route: RouteName): void {
  state.pinnedRoute = route;
}

export function unpinRoute(): void {
  state.pinnedRoute = null;
}

function healthToRouteStatus(result: ProviderHealthResult): RouteHealthStatus {
  switch (result.status) {
    case "valid":
      return "ok";
    case "invalid":
      return "invalid";
    case "not_configured":
      return "not_configured";
    case "consent_required":
      return "consent_required";
    default:
      return "unreachable"; // unavailable
  }
}

/**
 * Reine Rangfolge-Berechnung (testbar ohne Netz):
 * - Gepinnte Route gewinnt immer (Administrator-Entscheidung), wenn sie
 *   nicht "not_configured" ist.
 * - Danach gesunde Routen in Prioritaets-Reihenfolge (Ollama-first).
 * - Ungesunde/unverfuegbare Routen ans Ende, konfigurierte vor nicht
 *   konfigurierten.
 */
export function rankRoutes(
  results: Record<RouteName, ProviderHealthResult | null>,
  pinnedRoute: RouteName | null,
): RouteName[] {
  const score = (route: RouteName): number => {
    const result = results[route];
    const status = result ? healthToRouteStatus(result) : "not_configured";
    const priority = ROUTE_PRIORITY.indexOf(route);
    // Admin-Pin siegt — aber nur, wenn die Route ueberhaupt konfiguriert ist.
    if (pinnedRoute === route && status !== "not_configured") return 0;
    if (status === "ok") return 10 + priority;
    if (status !== "not_configured") return 30 + priority; // unbrauchbar, aber konfiguriert
    return 40 + priority; // not_configured zuletzt
  };
  return [...ROUTE_PRIORITY].sort((a, b) => score(a) - score(b));
}

/** Erste benutzbare Route der Rangfolge (nicht not_configured). */
export function pickActiveRoute(
  results: Record<RouteName, ProviderHealthResult | null>,
  pinnedRoute: RouteName | null,
): RouteName | null {
  const ranked = rankRoutes(results, pinnedRoute);
  const first = ranked.find((route) => {
    const result = results[route];
    return result !== null && result.status !== "not_configured";
  });
  return first ?? null;
}

export interface RotationTickOptions {
  now?: () => number;
  minIntervalMs?: number;
  consentHuggingFace?: boolean;
  fetcher?: typeof fetch;
  /** Tests: Netzproben ueberspringen und nur rechnen. */
  offline?: boolean;
}

/**
 * Ein Rotationsschritt: alle Routen proben (unkritische Endpunkte,
 * keine Completions, kein Token-Verbrauch), Rangfolge berechnen und
 * in den LLM-Router uebernehmen. Rueckgabe: Status nach dem Tick.
 */
export async function runRotationTick(options: RotationTickOptions = {}): Promise<RotationStatus> {
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? 60_000;
  const at = now();
  if (at - state.lastTickAt < minInterval) return getRotationStatus();

  const results: Record<RouteName, ProviderHealthResult | null> = {
    ollama: null, openrouter: null, groq: null, gemini: null, huggingface: null,
  };
  if (!options.offline) {
    for (const route of ROUTE_PRIORITY) {
      try {
        results[route] = await checkProviderHealth(route, {
          ...(options.fetcher ? { fetcher: options.fetcher } : {}),
          consentHuggingFace: options.consentHuggingFace === true,
          minIntervalMs: 0,
          now: options.now,
        });
      } catch {
        results[route] = { status: "unavailable", cached: false };
      }
    }
  }

  const ranked = rankRoutes(results, state.pinnedRoute);
  const active = pickActiveRoute(results, state.pinnedRoute);
  state.lastResults = Object.fromEntries(
    Object.entries(results).map(([route, result]) => [
      route,
      result ? { ...result, at } : null,
    ]),
  ) as RotatorState["lastResults"];
  state.activeRoute = active;
  state.lastTickAt = at;

  // Reihenfolge in den Fallback-Router uebernehmen: die gesundeste Route
  // wird zuerst probiert. Unbekannte Namen bleiben am Ende.
  if (!options.offline) setRegisteredProviderOrder(ranked);

  return getRotationStatus();
}

export type RotationStatus = {
  activeRoute: RouteName | null;
  pinnedRoute: RouteName | null;
  rankedRoutes: RouteName[];
  routes: Record<
    RouteName,
    { status: RouteHealthStatus; cost: "unlimited" | "free"; note: string; checkedAt: number | null }
  >;
  lastTickAt: number;
};

export function getRotationStatus(): RotationStatus {
  const ranked = rankRoutes(
    Object.fromEntries(
      ROUTE_PRIORITY.map((route) => [route, state.lastResults[route] ?? null]),
    ) as Record<RouteName, ProviderHealthResult | null>,
    state.pinnedRoute,
  );
  const routes = Object.fromEntries(
    ROUTE_PRIORITY.map((route) => {
      const result = state.lastResults[route];
      return [
        route,
        {
          status: result ? healthToRouteStatus(result) : "not_configured",
          cost: ROUTE_PROFILE[route].cost,
          note: ROUTE_PROFILE[route].note,
          checkedAt: result?.at ?? null,
        },
      ];
    }),
  ) as RotationStatus["routes"];
  return {
    activeRoute: state.activeRoute,
    pinnedRoute: state.pinnedRoute,
    rankedRoutes: ranked,
    routes,
    lastTickAt: state.lastTickAt,
  };
}
