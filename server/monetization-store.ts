/**
 * Sprint 103 / Master-Prompt Abschnitt 3.2 — Monetarisierungs-Store (DB-Layer).
 * Affiliate-Links, Sponsoring-Deals, Merch-Katalog. Zahlungen laufen
 * ausschliesslich ueber das Stripe-Doppelgate (billing.ts) — hier gibt es
 * bewusst keinen Checkout-Endpunkt.
 */

import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  affiliateLinks,
  sponsorshipDeals,
  merchProducts,
  type AffiliateLink,
  type SponsorshipDeal,
  type MerchProduct,
} from "../drizzle/schema";
import { validAffiliateLink, canAdvanceSponsorship, applyAffiliateClick, validMerchPrice } from "./monetization";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Datenbank nicht verfuegbar.");
  return db;
}

/* ---------------- Affiliate ---------------- */

export async function listAffiliateLinks(personaId?: number): Promise<AffiliateLink[]> {
  const db = await requireDb();
  const rows = personaId
    ? await db.select().from(affiliateLinks).where(eq(affiliateLinks.personaId, personaId)).orderBy(affiliateLinks.id)
    : await db.select().from(affiliateLinks).orderBy(affiliateLinks.id);
  return rows;
}

export async function createAffiliateLink(input: {
  personaId: number;
  label: string;
  url: string;
}): Promise<AffiliateLink> {
  if (!validAffiliateLink(input)) {
    throw new Error("Affiliate-Link ungueltig: Label 1-120 Zeichen und http(s)-URL noetig.");
  }
  const db = await requireDb();
  const [row] = await db
    .insert(affiliateLinks)
    .values({ personaId: input.personaId, label: input.label, url: input.url })
    .returning();
  return row;
}

/** Klick buchen (idempotent pro Klick, Provision optional). */
export async function registerAffiliateClick(
  id: number,
  commissionCents = 0
): Promise<AffiliateLink | null> {
  const db = await requireDb();
  const current = (await db.select().from(affiliateLinks).where(eq(affiliateLinks.id, id)).limit(1))[0];
  if (!current) return null;
  const next = applyAffiliateClick(current, commissionCents);
  const [row] = await db
    .update(affiliateLinks)
    .set(next)
    .where(eq(affiliateLinks.id, id))
    .returning();
  return row ?? null;
}

/* ---------------- Sponsoring ---------------- */

export async function listSponsorshipDeals(personaId?: number): Promise<SponsorshipDeal[]> {
  const db = await requireDb();
  const rows = personaId
    ? await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.personaId, personaId)).orderBy(desc(sponsorshipDeals.updatedAt))
    : await db.select().from(sponsorshipDeals).orderBy(desc(sponsorshipDeals.updatedAt));
  return rows;
}

export async function createSponsorshipLead(input: {
  personaId: number;
  sponsor: string;
  notes?: string;
}): Promise<SponsorshipDeal> {
  if (!input.sponsor?.trim() || input.sponsor.length > 160) {
    throw new Error("Sponsor-Name erforderlich (max. 160 Zeichen).");
  }
  const db = await requireDb();
  const [row] = await db
    .insert(sponsorshipDeals)
    .values({ personaId: input.personaId, sponsor: input.sponsor, notes: input.notes ?? "" })
    .returning();
  return row;
}

/** Stage-Übergang nur entlang der geprueften Pipeline. */
export async function advanceSponsorship(
  id: number,
  to: SponsorshipDeal["stage"],
  valueCents?: number
): Promise<SponsorshipDeal | null> {
  const db = await requireDb();
  const current = (await db.select().from(sponsorshipDeals).where(eq(sponsorshipDeals.id, id)).limit(1))[0];
  if (!current) return null;
  if (!canAdvanceSponsorship(current.stage, to)) {
    throw new Error(`Sponsoring-Übergang ${current.stage} → ${to} ist nicht zulaessig.`);
  }
  const [row] = await db
    .update(sponsorshipDeals)
    .set({
      stage: to,
      ...(to === "closed" && typeof valueCents === "number" ? { valueCents: Math.max(0, Math.round(valueCents)) } : {}),
    })
    .where(eq(sponsorshipDeals.id, id))
    .returning();
  return row ?? null;
}

/* ---------------- Merch ---------------- */

export async function listMerch(activeOnly = true): Promise<MerchProduct[]> {
  const db = await requireDb();
  const rows = await db.select().from(merchProducts).orderBy(merchProducts.id);
  return activeOnly ? rows.filter((r) => r.active) : rows;
}

export async function createMerchProduct(input: {
  name: string;
  description?: string;
  priceCents: number;
  kind?: "digital" | "physical";
}): Promise<MerchProduct> {
  if (!input.name?.trim() || input.name.length > 160) {
    throw new Error("Produktname erforderlich (max. 160 Zeichen).");
  }
  if (!validMerchPrice(input.priceCents)) {
    throw new Error("Preis ungueltig: positive ganze Cent-Beträge unter 1 Mio. Euro.");
  }
  const db = await requireDb();
  const [row] = await db
    .insert(merchProducts)
    .values({
      name: input.name,
      description: input.description ?? "",
      priceCents: input.priceCents,
      kind: input.kind ?? "digital",
    })
    .returning();
  return row;
}
