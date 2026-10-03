/**
 * Sprint 079 — Limit-Erholung: Wenn ALLE Routen der Kette zeitweise im
 * Kontingent-Cooldown stecken (Rate-Limit 429/402, kurze Ausfaelle),
 * entscheidet dieses Modul deterministisch, ob ein kurzes Warten auf das
 * naechste Kontingentfenster Erfolg verspricht — oder ob ehrlich
 * abgebrochen wird (Tageskontingent, Auth-Sperren).
 *
 * Ehrlichkeit vor "Unlimited": Free-Tier-Kontingente sind externe,
 * harte Limits. Dieses Modul maximiert die Verfuegbarkeit innerhalb
 * eines begrenzten Wartebudgets — es kann ein abgelaufenes
 * Tageskontingent nicht herbeizaubern und behauptet das auch nicht.
 */
import type { ProviderCooldownKind } from "./provider-cooldown";
import type { ProviderName } from "./provider-registry";

export type ChainCooldownSnapshot = {
  provider: ProviderName;
  kind: ProviderCooldownKind;
  untilMs: number;
};

export type RecoveryDecision =
  | { action: "retry-now"; reason: string }
  | { action: "wait"; waitMs: number; reason: string }
  | { action: "fail"; reason: string };

/** Standard-Wartebudget: nie laenger als 60 s auf ein Fenster warten. */
export const DEFAULT_WAIT_BUDGET_MS = 60_000;
/** Obergrenze fuer das konfigurierbare Budget (ROUTE_WAIT_BUDGET_MS). */
export const MAX_WAIT_BUDGET_MS = 300_000;

/**
 * Sperrarten, auf die ein kurzes Warten lohnt: Kontingentfenster (limit)
 * und kurze Ausfaelle (timeout). Auth-Sperren (30 min, ungueltiger
 * Schluessel) sind kein Warte-/Rotationsfall — sie brauchen Menschen.
 */
export const WAITABLE_COOLDOWN_KINDS: readonly ProviderCooldownKind[] = [
  "limit",
  "timeout",
];

/** Liest ROUTE_WAIT_BUDGET_MS begrenzt; ungueltige Werte nutzen den Default. */
export function waitBudgetMs(): number {
  const raw = Number(process.env.ROUTE_WAIT_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WAIT_BUDGET_MS;
  return Math.min(Math.round(raw), MAX_WAIT_BUDGET_MS);
}

export function planChainRecovery(input: {
  /** Anzahl bereits gelaufener Kettenlaeufe (>= 1). */
  chainRuns: number;
  /** Hartes Limit: danach wird ehrlich abgebrochen, keine Endlosschleife. */
  maxChainRuns: number;
  waitBudgetMs: number;
  now: number;
  /** Routen der gelaufenen Kette (nach Pin-/Consent-Filter). */
  routes: ProviderName[];
  /** Aktuelle Cooldown-Snapshotwerte dieser Routen. */
  cooldowns: ChainCooldownSnapshot[];
}): RecoveryDecision {
  if (input.chainRuns >= input.maxChainRuns)
    return {
      action: "fail",
      reason: `Begrenzte Erholungslauefe erreicht (${input.chainRuns}/${input.maxChainRuns}) — kein Endlos-Retry.`,
    };

  // Freie Route in Sicht? Sofort noch einmal probieren.
  const freeRoute = input.routes.find(
    name =>
      !input.cooldowns.some(
        c => c.provider === name && c.untilMs > input.now
      )
  );
  if (freeRoute)
    return {
      action: "retry-now",
      reason: `Route ${freeRoute} ist wieder frei`,
    };

  // Keine freie Route: Ist ueberhaupt eine Sperrung wartewuerdig?
  const waitable = input.cooldowns
    .filter(c => WAITABLE_COOLDOWN_KINDS.includes(c.kind) && c.untilMs > input.now)
    .sort((a, b) => a.untilMs - b.untilMs);
  if (waitable.length === 0)
    return {
      action: "fail",
      reason:
        "Alle Routen sind dauerhaft gesperrt (z. B. Auth) — kein Rotations-/Wartefall.",
    };

  const nearest = waitable[0]!;
  const waitMs = nearest.untilMs - input.now;
  if (waitMs > input.waitBudgetMs)
    return {
      action: "fail",
      reason: `Naechstes Kontingentfenster (${nearest.provider}) oeffnet in ${Math.round(waitMs / 1000)} s — ausserhalb des Wartebudgets von ${Math.round(input.waitBudgetMs / 1000)} s. Ehrlicher Abbruch statt Haengen.`,
    };

  return {
    action: "wait",
    waitMs,
    reason: `Alle Routen im Kontingent-Cooldown — warte ${Math.round(waitMs / 1000)} s auf ${nearest.provider}`,
  };
}
