/**
 * Sprint 103 / Master-Prompt Abschnitt 3.2 — Monetarisierungspfade.
 *
 * Affiliate-Links (Klick-Tracking), Sponsoring-Pipeline (Lead → Kontakt →
 * Verhandlung → Abschluss), Merch/Digital Products. Bezahlt wird alles
 * ausschliesslich ueber das bestehende Stripe-Doppelgate (Secret + explizite
 * Admin-Freigabe) aus Abschnitt 2.2 — hier gibt es KEINE Zahlungsfreigabe.
 */

export type SponsorshipStage = "lead" | "contacted" | "negotiating" | "closed" | "declined";

/**
 * Sponsoring-Stages mit Richtung: Vorwaerts nur Schritt fuer Schritt,
 * Absage von jeder Vorwaerts-Stage. 'closed' ist terminal.
 */
const SPONSORSHIP_FLOW: Record<SponsorshipStage, SponsorshipStage[]> = {
  lead: ["contacted", "declined"],
  contacted: ["negotiating", "declined"],
  negotiating: ["closed", "declined"],
  closed: [],
  declined: [],
};

/** Legalitaet eines Stage-Uebergangs (deterministisch, testbar). */
export function canAdvanceSponsorship(
  from: SponsorshipStage,
  to: SponsorshipStage
): boolean {
  return (SPONSORSHIP_FLOW[from] ?? []).includes(to);
}

/** Naechste zulaessige Vorwaerts-Stages (fuer UI/Hinweise). */
export function nextSponsorshipStages(from: SponsorshipStage): SponsorshipStage[] {
  return [...(SPONSORSHIP_FLOW[from] ?? [])];
}

/** Affiliate-Klick-Validierung: URL muss http(s) sein, Label gefuellt. */
export function validAffiliateLink(input: { label: string; url: string }): boolean {
  if (!input.label?.trim() || input.label.length > 120) return false;
  try {
    const url = new URL(input.url);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Affiliate-Klick buchen: erhoeht Klickzahl und optional Umsatz (Provision).
 * Rein funktional — Persistenz macht der Router.
 */
export function applyAffiliateClick(
  link: { clickCount: number; revenueCents: number },
  commissionCents = 0
): { clickCount: number; revenueCents: number } {
  return {
    clickCount: link.clickCount + 1,
    revenueCents: Math.max(0, link.revenueCents + Math.max(0, Math.round(commissionCents))),
  };
}

/** Merch-Preis-Validierung: 0 < Preis < 1 Mio Euro, keine negativen Werte. */
export function validMerchPrice(priceCents: number): boolean {
  return Number.isInteger(priceCents) && priceCents > 0 && priceCents < 100_000_000;
}

/**
 * Content-Tier-Mapping auf das Subscriptionssystem aus Abschnitt 2.2:
 * 'free' sieht Basisthesen, 'pro' exklusive Tiers (Dossiers, Fruehzugang).
 * Erweiterbar ohne Schemaaenderung — Bewertung bleibt in billing/subscription.
 */
export type ContentTier = "free" | "pro";

export function contentTierForPlan(plan: "free" | "pro"): ContentTier {
  return plan === "pro" ? "pro" : "free";
}

/** Was ein Tier enthaelt (Transparenz gegenueber Fans). */
export const TIER_BENEFITS: Record<ContentTier, string[]> = {
  free: ["Oeffentliche Posts", "Newsletter"],
  pro: ["Exklusive Dossier-Zugriffe", "Fruehzugang auf Inhalte", "Community-Fragerunden"],
};
