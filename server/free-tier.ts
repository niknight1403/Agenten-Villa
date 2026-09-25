import { createHash } from "node:crypto";

/**
 * Free-Tier-Optimierung: Antwort-Cache, In-Flight-Dedupe und freie Modellkette.
 *
 * Ziel: das kostenlose Kontingent maximieren, OHNE Limits zu umgehen oder
 * "unlimited" vorzutaeuschen. Identische Anfragen werden bis zu TTL_MS
 * aus dem Cache beantwortet (0 Token); identische, GLEICHZEITIGE Anfragen
 * teilen sich einen einzigen Anbieter-Aufruf.
 */

const MAX_CACHE_ENTRIES = 256;
const DEFAULT_TTL_SECONDS = 600;

export type CachedAnswer = { answer: string; model: string; provider: string };

const cache = new Map<string, { entry: CachedAnswer; expiresAt: number }>();
const inflight = new Map<string, Promise<unknown>>();

/** Freie Modellkette: Default ist der OpenRouter-Auto-Free-Router. */
export function freeModels(): string[] {
  const raw = process.env.OPENROUTER_MODELS?.trim();
  const chain = raw
    ? raw
        .split(",")
        .map(m => m.trim())
        .filter(Boolean)
    : ["openrouter/free"];
  return chain.slice(0, 6);
}

/**
 * Cache aktiv: in Produktion standardmäßig an, ueberall sonst aus.
 * FREE_TIER_CACHE=0 erzwingt aus, =1 erzwingt an (z. B. fuer lokale Tests).
 */
export function cacheEnabled(): boolean {
  const flag = process.env.FREE_TIER_CACHE?.trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return process.env.NODE_ENV === "production";
}

export function cacheKey(messages: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

export function readCache(key: string): CachedAnswer | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  // LRU: Zugriff frischt die Position auf.
  cache.delete(key);
  cache.set(key, hit);
  return hit.entry;
}

export function writeCache(key: string, entry: CachedAnswer): void {
  const ttlSeconds =
    Number(process.env.FREE_TIER_CACHE_TTL_SECONDS?.trim()) ||
    DEFAULT_TTL_SECONDS;
  if (ttlSeconds <= 0) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { entry, expiresAt: Date.now() + ttlSeconds * 1_000 });
}

/** Identische gleichzeitige Anfragen teilen sich genau einen Lauf. */
export async function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** Nur fuer Tests: Zustand zwischen Laeufen zuruecksetzen. */
export function resetFreeTierState(): void {
  cache.clear();
  inflight.clear();
}
