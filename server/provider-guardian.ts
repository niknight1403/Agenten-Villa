/**
 * Provider-Wächter ("Free-Route Guardian").
 *
 * Ein Administrator-Agent, der die kostenlosen Modellrouten der Villa
 * fortlaufend prüft, tote oder limitierte Routen in einen Cooldown schickt
 * und die tatsächlich funktionsfähige kostenlose Route automatisch als
 * aktive Route wählt.
 *
 * Bewusste Grenze: Der Wächter maximiert die Verfügbarkeit der kostenlosen
 * Routen und hält sie funktionsfähig. Er erzeugt KEINE unbegrenzten Token,
 * rotiert keine Schlüssel, umgeht keine Anbieterkontingente und fälscht keine
 * Kontingent-Anzeigen. Das lokale "Elite"-Paket bedeutet: kein lokales
 * Chat-/Token-Gesamtkontingent in der Villa. Technische Modellgrenzen und
 * Kontingente externer Anbieter gelten unverändert.
 */
import {
  HUGGINGFACE_CHAT_URL,
  hfModel,
  openRouterChatUrl,
  openRouterModelsUrl,
} from "./provider-endpoints";
import { freeModels } from "./free-tier";

export type RouteStatus = "unknown" | "healthy" | "cooling" | "unavailable";

export type RouteState = {
  model: string;
  status: RouteStatus;
  cooldownUntil: number | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastDetail: string | null;
  consecutiveFailures: number;
  probes: number;
  successes: number;
  failures: number;
};

export type ProviderOutcome =
  | "ok"
  | "limit"
  | "unavailable"
  | "auth"
  | "rejected";

const COOLDOWN_MS: Record<"limit" | "unavailable" | "auth", number> = {
  limit: 5 * 60 * 1000,
  unavailable: 60 * 1000,
  auth: 30 * 60 * 1000,
};

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 30 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 12_000;

type GuardianState = {
  enabled: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  runCount: number;
  lastError: string | null;
  catalogReachable: boolean | null;
  routes: Map<string, RouteState>;
};

const state: GuardianState = {
  enabled: true,
  intervalMs: readInterval(),
  lastRunAt: null,
  lastRunDurationMs: null,
  runCount: 0,
  lastError: null,
  catalogReachable: null,
  routes: new Map(),
};

let timer: ReturnType<typeof setInterval> | null = null;

function readInterval(): number {
  const configured = Number(process.env.PROVIDER_GUARDIAN_INTERVAL_MS?.trim());
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(configured)));
}

function emptyRoute(model: string): RouteState {
  return {
    model,
    status: "unknown",
    cooldownUntil: null,
    lastCheckedAt: null,
    lastLatencyMs: null,
    lastDetail: null,
    consecutiveFailures: 0,
    probes: 0,
    successes: 0,
    failures: 0,
  };
}

function routeState(model: string): RouteState {
  let entry = state.routes.get(model);
  if (!entry) {
    entry = emptyRoute(model);
    state.routes.set(model, entry);
  }
  return entry;
}

function isCooling(entry: RouteState, now = Date.now()): boolean {
  return entry.cooldownUntil !== null && entry.cooldownUntil > now;
}

/** Reads the persisted state without mutating anything. */
export function readRoute(model: string): RouteState {
  return { ...routeState(model) };
}

/**
 * Applies a real provider outcome to a route. Called from the request path so
 * health reflects actual traffic, not only scheduled probes.
 */
export function reportProviderOutcome(
  model: string,
  outcome: ProviderOutcome,
  detail?: string
): void {
  const entry = routeState(model);
  const now = Date.now();
  entry.probes += 1;
  entry.lastCheckedAt = new Date(now).toISOString();
  entry.lastDetail = detail?.slice(0, 200) ?? null;

  if (outcome === "ok") {
    entry.successes += 1;
    entry.consecutiveFailures = 0;
    entry.status = "healthy";
    entry.cooldownUntil = null;
    return;
  }

  entry.failures += 1;
  entry.consecutiveFailures += 1;
  if (outcome === "rejected") {
    // Der Anbieter hat die Anfrage inhaltlich abgelehnt; die Route selbst
    // bleibt gesund und darf weiter verwendet werden.
    entry.status = entry.status === "healthy" ? "healthy" : "unknown";
    return;
  }
  const key = outcome === "limit" ? "limit" : outcome === "auth" ? "auth" : "unavailable";
  entry.status = outcome === "auth" ? "unavailable" : "cooling";
  entry.cooldownUntil = now + COOLDOWN_MS[key];
}

/**
 * Gesunde Kette: funktionsfähige Routen zuerst, dann ungeprüfte, zuletzt
 * Routen im Cooldown. Die Liste ist nie leer, damit der Aufrufer fail-closed
 * bleibt und ein echter Anbieterfehler nicht stillschweigend verschluckt wird.
 */
export function guardianChain(): string[] {
  const configured = freeModels();
  if (!state.enabled) return configured;
  const now = Date.now();
  const rank = (model: string): number => {
    const entry = state.routes.get(model);
    if (!entry) return 1;
    if (isCooling(entry, now)) return 2;
    if (entry.status === "healthy") return 0;
    if (entry.status === "unavailable" && entry.consecutiveFailures >= 2) return 2;
    return 1;
  };
  return configured
    .map((model, index) => ({ model, index, rank: rank(model) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(item => item.model);
}

/** Currently preferred free route, or null when no chain is configured. */
export function activeRoute(): string | null {
  return guardianChain()[0] ?? null;
}

async function probeModel(
  fetcher: typeof fetch,
  key: string,
  model: string
): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const started = Date.now();
  try {
    const response = await fetcher(openRouterChatUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (response.status === 200) return { ok: true, latencyMs, detail: "Route antwortet" };
    if (response.status === 402 || response.status === 429)
      return { ok: false, latencyMs, detail: `Kontingent ${response.status}` };
    if (response.status === 401 || response.status === 403)
      return { ok: false, latencyMs, detail: `Schlüssel ${response.status}` };
    return { ok: false, latencyMs, detail: `HTTP ${response.status}` };
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: "nicht erreichbar",
    };
  }
}

async function probeCatalog(fetcher: typeof fetch, key: string): Promise<boolean> {
  try {
    const response = await fetcher(openRouterModelsUrl(), {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

function classifyDetail(detail: string): ProviderOutcome {
  if (detail.startsWith("Kontingent")) return "limit";
  if (detail.startsWith("Schlüssel")) return "auth";
  return "unavailable";
}

export type GuardianRunResult = {
  ok: boolean;
  catalogReachable: boolean;
  activeModel: string | null;
  healthy: string[];
  cooling: string[];
  durationMs: number;
  skippedReason?: string;
};

/**
 * Ein vollständiger Prüfzyklus: Katalog erreichbar? Jede konfigurierte freie
 * Route mit einer minimalen echten Anfrage prüfen und Zustand aktualisieren.
 */
export async function runGuardianCycle(
  deps: { fetcher?: typeof fetch } = {}
): Promise<GuardianRunResult> {
  const started = Date.now();
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const chain = freeModels();

  if (!key) {
    state.lastRunAt = new Date().toISOString();
    state.lastRunDurationMs = Date.now() - started;
    state.lastError = "Kein OpenRouter-Schlüssel konfiguriert.";
    return {
      ok: false,
      catalogReachable: false,
      activeModel: null,
      healthy: [],
      cooling: [],
      durationMs: state.lastRunDurationMs,
      skippedReason: "MISSING_KEY",
    };
  }

  const fetcher = deps.fetcher ?? fetch;
  state.catalogReachable = await probeCatalog(fetcher, key);

  for (const model of chain) {
    const { ok, latencyMs, detail } = await probeModel(fetcher, key, model);
    const entry = routeState(model);
    entry.lastLatencyMs = latencyMs;
    if (ok) reportProviderOutcome(model, "ok", detail);
    else reportProviderOutcome(model, classifyDetail(detail), detail);
  }

  state.lastRunAt = new Date().toISOString();
  state.lastRunDurationMs = Date.now() - started;
  state.lastError = null;
  state.runCount += 1;

  const now = Date.now();
  const routes = chain.map(model => routeState(model));
  return {
    ok: state.catalogReachable,
    catalogReachable: Boolean(state.catalogReachable),
    activeModel: activeRoute(),
    healthy: routes.filter(r => r.status === "healthy").map(r => r.model),
    cooling: routes.filter(r => isCooling(r, now)).map(r => r.model),
    durationMs: state.lastRunDurationMs,
  };
}

export const GUARDIAN_NOTE =
  "Der Provider-Wächter prüft die kostenlosen Modellrouten autonom, hält funktionsfähige Routen aktiv und setzt tote oder limitierte Routen in einen Cooldown. Er erzeugt keine unbegrenzten Token und umgeht keine Kontingente externer Anbieter.";

export function getGuardianSnapshot() {
  const now = Date.now();
  const configured = freeModels();
  return {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    lastRunAt: state.lastRunAt,
    lastRunDurationMs: state.lastRunDurationMs,
    runCount: state.runCount,
    lastError: state.lastError,
    catalogReachable: state.catalogReachable,
    activeModel: activeRoute(),
    chain: guardianChain(),
    configuredChain: configured,
    freeTierFirst: true as const,
    fallback: huggingFaceFallbackDescriptor(),
    routes: configured.map(model => {
      const entry = routeState(model);
      return {
        model: entry.model,
        status: entry.status,
        cooling: isCooling(entry, now),
        cooldownUntil: entry.cooldownUntil
          ? new Date(entry.cooldownUntil).toISOString()
          : null,
        lastCheckedAt: entry.lastCheckedAt,
        lastLatencyMs: entry.lastLatencyMs,
        lastDetail: entry.lastDetail,
        consecutiveFailures: entry.consecutiveFailures,
        probes: entry.probes,
        successes: entry.successes,
        failures: entry.failures,
      };
    }),
    note: GUARDIAN_NOTE,
  };
}

export function setGuardianEnabled(enabled: boolean): boolean {
  state.enabled = enabled;
  if (!enabled) stopProviderGuardian();
  return state.enabled;
}

export function setGuardianIntervalMs(intervalMs: number): number {
  state.intervalMs = Math.min(
    MAX_INTERVAL_MS,
    Math.max(MIN_INTERVAL_MS, Math.floor(intervalMs))
  );
  if (timer) startProviderGuardian();
  return state.intervalMs;
}

/** Starts the autonomous cycle. Idempotent; the timer never keeps Node alive. */
export function startProviderGuardian(): void {
  if (!state.enabled) return;
  stopProviderGuardian();
  void runGuardianCycle().catch(error => {
    state.lastError = String(error).slice(0, 200);
  });
  timer = setInterval(() => {
    void runGuardianCycle().catch(error => {
      state.lastError = String(error).slice(0, 200);
    });
  }, state.intervalMs);
  timer.unref?.();
}

export function stopProviderGuardian(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Exposed for the Hugging Face fallback so its health is visible too. */
export function huggingFaceFallbackDescriptor() {
  return {
    provider: "huggingface" as const,
    model: hfModel(),
    url: HUGGINGFACE_CHAT_URL,
    configured: Boolean(process.env.HF_TOKEN?.trim()),
  };
}

export function resetProviderGuardianForTests(): void {
  stopProviderGuardian();
  state.routes.clear();
  state.enabled = true;
  state.intervalMs = readInterval();
  state.lastRunAt = null;
  state.lastRunDurationMs = null;
  state.runCount = 0;
  state.lastError = null;
  state.catalogReachable = null;
}

