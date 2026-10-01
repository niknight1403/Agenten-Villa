/**
 * Sprint 034 — Cooldown-Mechanismus: fehlerhafte Anbieter werden zeitlich
 * begrenzt uebersprungen, damit die Failover-Kette nicht bei jedem Aufruf
 * erneut gegen ein erschöpftes oder ungültiges Kontingent läuft.
 *
 * Die Sperrung ist prozesslokal und pro Anbieter; die Kette bleibt
 * fail-closed (siehe Agent-Engine): solange kein anderer Anbieter nutzbar
 * ist, wird der gesperrte Anbieter trotzdem ehrlich versucht.
 */
import type { ProviderName } from "./provider-registry";

export type ProviderCooldownKind = "auth" | "limit";

/** Dokumentierte Standard-Sperrzeiten je Fehlerart. */
const DEFAULT_COOLDOWN_MS: Record<ProviderCooldownKind, number> = {
  auth: 30 * 60 * 1000,
  limit: 5 * 60 * 1000,
};

/** Retry-After kann Stunden nennen (Tageskontingent): begrenzt auf 60 min. */
const MAX_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

type CooldownEntry = {
  kind: ProviderCooldownKind;
  until: number;
};

const providerCooldowns = new Map<ProviderName, CooldownEntry>();

/**
 * Sperrt einen Anbieter zeitlich begrenzt. Bei "limit" mit dokumentiertem
 * Retry-After (Sekunden) gilt dieser Wert — begrenzt auf 60 Minuten;
 * "0" bedeutet "sofort wieder" und sperrt nicht. Eine bestehende,
 * laengere Sperre wird nie verkuerzt.
 */
export function markProviderFailure(
  name: ProviderName,
  kind: ProviderCooldownKind,
  retryAfterSeconds?: number
): number {
  const now = Date.now();
  let ms = DEFAULT_COOLDOWN_MS[kind];
  if (kind === "limit" && retryAfterSeconds !== undefined) {
    if (retryAfterSeconds <= 0) return existingUntil(name, now);
    ms = Math.min(retryAfterSeconds * 1000, MAX_LIMIT_COOLDOWN_MS);
  }
  const until = now + ms;
  const previous = providerCooldowns.get(name);
  providerCooldowns.set(name, {
    kind,
    until: previous ? Math.max(previous.until, until) : until,
  });
  return providerCooldowns.get(name)!.until;
}

function existingUntil(name: ProviderName, now: number): number {
  return providerCooldowns.get(name)?.until ?? now;
}

/** Sperrdauer-Anfangspunkt oder undefined, wenn der Anbieter nicht gesperrt ist. */
export function providerCooldownUntil(
  name: ProviderName
): number | undefined {
  const entry = providerCooldowns.get(name);
  return entry === undefined || entry.until <= Date.now()
    ? undefined
    : entry.until;
}

/** True, solange der Anbieter zeitlich begrenzt gesperrt ist. */
export function providerInCooldown(
  name: ProviderName,
  now = Date.now()
): boolean {
  const entry = providerCooldowns.get(name);
  return entry !== undefined && entry.until > now;
}

/** Sperrt alle Anbieter für Tests zurück. */
export function clearProviderCooldownsForTests(): void {
  providerCooldowns.clear();
}
