/**
 * Sprint 079 — Admin-Pin: Der Administrator kann die automatische
 * Multi-Provider-Kette auf EINEN Anbieter erzwingen (z. B. weil eine
 * lokale oder freie Route bewusst getestet werden soll). Der Pin ist
 * prozesslokal, bewusst nicht persistiert (Prozessneustart = Auto-Kette)
 * und wird nur mit Admin-Recht gesetzt (siehe systemRouter).
 *
 * Der Pin aendert NICHT die Sicherheitsregeln: Consent-Filter (HF),
 * Aktivstatus und Schluesselkonfiguration bleiben verbindlich. Ein Pin
 * auf einen nicht nutzbaren Anbieter scheitert ehrlich mit einer
 * klar benannten Fehlermeldung an der Engine.
 */
import {
  DOCUMENTED_FALLBACK_ORDER,
  isProviderActive,
  type ProviderName,
} from "./provider-registry";

export type RouteOverride = {
  provider: ProviderName;
  /** E-Mail des Admins, der den Pin gesetzt hat. */
  by: string;
  setAt: string;
};

let override: RouteOverride | null = null;

/** Katalog der pinnbaren Anbieter (dokumentierte Namen, deterministisch). */
export function pinnableProviders(): ProviderName[] {
  return [...DOCUMENTED_FALLBACK_ORDER];
}

/**
 * Setzt den Pin. Zurueckgegeben wird der neue Pin oder null, wenn der
 * Anbieter abgelehnt wurde (unbekannt, oder im Register nicht "active").
 */
export function setRouteOverride(
  provider: ProviderName,
  by: string
): RouteOverride | null {
  if (!pinnableProviders().includes(provider)) return null;
  if (!isProviderActive(provider)) return null;
  override = {
    provider,
    by,
    setAt: new Date().toISOString(),
  };
  return override;
}

/** Hebt den Pin auf; die Engine kehrt zur automatischen Kette zurueck. */
export function clearRouteOverride(): void {
  override = null;
}

/** Aktueller Pin oder null (Auto-Kette). */
export function getRouteOverride(): RouteOverride | null {
  return override;
}

/** Nur fuer Tests. */
export function resetRouteOverrideForTests(): void {
  override = null;
}
