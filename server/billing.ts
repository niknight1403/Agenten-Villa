/**
 * Sprint 103 — Token-Abrechnung & Paywall (Master-Prompt Abschnitt 2.2).
 *
 * Monatliche, pro Tenant gemessene Token-Nutzung als Basis der
 * API-Tier-Abrechnung. Die reine Kernlogik (Periode, Quota, Paywall)
 * ist deterministisch getestet; der Meter ist bewusst fehlertolerant
 * (Abrechnung darf den Agent-Betrieb niemals blockieren).
 *
 * Stripe-Checkout: echte Keys werden AUSSCHLIESSLICH nach getrennter
 * Admin-Freigabe eingebunden. Ohne STRIPE_SECRET_KEY meldet der
 * Checkout-Endpunkt ehrlich "nicht konfiguriert" statt eine
 * Schein-Integration.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { tokenUsageMonthly } from "../drizzle/schema";
import {
  effectiveFeatures,
  getSubscription,
  PLAN_FEATURES,
  type SubscriptionState,
} from "./subscription";

export type UsagePeriod = string; // 'YYYY-MM'

/** Aktuelle Abrechnungsperiode (UTC). */
export function currentPeriod(now = new Date()): UsagePeriod {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type BillingSummary = {
  plan: string;
  tierName: string;
  period: UsagePeriod;
  tokensUsed: number;
  tokenBudget: number;
  percentUsed: number;
  /** true, wenn das Budget verbraucht ist (Paywall greift). */
  quotaExceeded: boolean;
};

/** Reine Zusammenfassung (testbar ohne DB). */
export function summarizeUsage(
  state: SubscriptionState,
  tokensUsed: number,
  now = new Date()
): BillingSummary {
  const features = effectiveFeatures(state);
  const budget = features.monthlyTokenBudget;
  return {
    plan: state.plan,
    tierName: features.tierName,
    period: currentPeriod(now),
    tokensUsed,
    tokenBudget: budget,
    percentUsed: budget > 0 ? Math.min(100, Math.round((tokensUsed / budget) * 100)) : 100,
    quotaExceeded: tokensUsed >= budget,
  };
}

export class PaywallError extends Error {
  readonly summary: BillingSummary;
  constructor(summary: BillingSummary) {
    super("Token-Budget aufgebraucht: Upgrade für weitere LLM-Läufe erforderlich.");
    this.name = "PaywallError";
    this.summary = summary;
  }
}

/**
 * Paywall-Guard vor einem Agent-Lauf: wirft PaywallError, wenn das
 * monatliche Budget des Tiers aufgebraucht ist. Aufrufer (tRPC) wandelt
 * den Fehler in einen nutzerfreundlichen, upgradebaren Fehler um.
 */
export function assertTokenBudget(
  state: SubscriptionState,
  tokensUsed: number,
  now = new Date()
): void {
  const summary = summarizeUsage(state, tokensUsed, now);
  if (summary.quotaExceeded) throw new PaywallError(summary);
}

/* ------------------------------------------------------------------ */
/* Metering (DB)                                                       */
/* ------------------------------------------------------------------ */

function requireDb() {
  return getDb();
}

/** Gezaehlte Tokens des Nutzers in der aktuellen Periode (0 bei Fehler). */
export async function readTokensUsed(userId: number, period = currentPeriod()): Promise<number> {
  try {
    const db = (await requireDb())!;
    const rows = await db
      .select({ tokens: tokenUsageMonthly.tokens })
      .from(tokenUsageMonthly)
      .where(and(eq(tokenUsageMonthly.userId, userId), eq(tokenUsageMonthly.period, period)))
      .limit(1);
    return rows[0]?.tokens ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Metering nach einem Agent-Lauf: addiert die Token-Nutzung (Prompt +
 * Completion) auf den monatlichen Zaehler des Tenants. Bewusst
 * fehlertolerant — Abrechnungsfehler duerfen den Lauf nie gefaehrden.
 */
export async function meterTokenUsage(
  userId: number,
  tokens: number,
  now = new Date()
): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  try {
    const db = (await requireDb())!;
    const period = currentPeriod(now);
    const existing = await readTokensUsed(userId, period);
    if (existing > 0) {
      await db
        .update(tokenUsageMonthly)
        .set({ tokens: existing + Math.floor(tokens) })
        .where(and(eq(tokenUsageMonthly.userId, userId), eq(tokenUsageMonthly.period, period)));
    } else {
      await db
        .insert(tokenUsageMonthly)
        .values({ userId, period, tokens: Math.floor(tokens) });
    }
  } catch {
    /* Metering best-effort */
  }
}

/** Vollstaendige Abrechnungsuebersicht eines Tenants (fuer Dashboard/Onboarding). */
export async function billingSummary(userId: number, now = new Date()): Promise<BillingSummary> {
  const state = await getSubscription(userId);
  const tokensUsed = await readTokensUsed(userId, currentPeriod(now));
  return summarizeUsage(state, tokensUsed, now);
}

/* ------------------------------------------------------------------ */
/* Checkout (Stripe vorbereitet, bis Admin-Keys da sind)                */
/* ------------------------------------------------------------------ */

export type CheckoutAvailability = {
  available: boolean;
  reason: string;
  /** true, solange die getrennte Admin-Freigabe fehlt. */
  requiresAdminApproval: boolean;
};

/**
 * Checkout-Verfuegbarkeit: Stripe wird erst nach getrennter
 * Admin-Freigabe freigeschaltet — dafuer muessen BEIDE Env-Variablen
 * gesetzt sein: STRIPE_SECRET_KEY (Keys) und STRIPE_CHECKOUT_APPROVED
 * (die ausdrueckliche Freigabe). Kein Platzhalter-Flow, keine
 * Schein-Zahlung.
 */
export function checkoutAvailability(): CheckoutAvailability {
  const hasKeys = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const approved = process.env.STRIPE_CHECKOUT_APPROVED === "true";
  if (!hasKeys) {
    return {
      available: false,
      reason: "Stripe nicht konfiguriert — STRIPE_SECRET_KEY und getrennte Admin-Freigabe erforderlich.",
      requiresAdminApproval: true,
    };
  }
  if (!approved) {
    return {
      available: false,
      reason: "Stripe-Keys vorhanden — es fehlt die getrennte Admin-Freigabe (STRIPE_CHECKOUT_APPROVED=true).",
      requiresAdminApproval: true,
    };
  }
  return {
    available: true,
    reason: "Checkout freigegeben.",
    requiresAdminApproval: false,
  };
}

/** Tier-Katalog fuer Onboarding/Paywall-Darstellung. */
export function planCatalog() {
  return { plans: [PLAN_FEATURES.free, PLAN_FEATURES.pro] };
}
