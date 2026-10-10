/**
 * Sprint 103 — SaaS-Subscription-Lifecycle (Master-Prompt Abschnitt 2.2).
 *
 * Vollautomatische Subskriptionsverwaltung pro Tenant (Nutzer):
 *   trial (14 Tage) → active (Upgrade auf Pro)
 *   cancel → bleibt aktiv bis Periodenende → grace (7 Tage) → expired
 *   past_due bei fehlender Zahlung → degraded auf Free-Rechte nach Grace.
 *
 * Die reine Zustandsmaschine `transitionSubscription` ist deterministisch
 * und voll getestet; die DB-Funktionen folgen dem villa-store-Muster.
 * Checkout: Stripe-Keys werden erst nach getrennter Admin-Freigabe
 * eingebunden (siehe billing.ts) — bis dahin bleibt der Upgrade-Endpunkt
 * technisch gesperrt.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { subscriptions, type Subscription } from "../drizzle/schema";

export type Plan = "free" | "pro";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled" | "expired";

export type PlanFeatures = {
  plan: Plan;
  /** Maximale Villen pro Tenant. */
  maxVillas: number;
  /** Token-Budget pro Monat. */
  monthlyTokenBudget: number;
  /** Parallele Agent-Laeufe. */
  maxConcurrentRuns: number;
  /** API-Tier-Name (sichtbar im Dashboard). */
  tierName: string;
};

/** API-Tier-Modell: Free bewusst knapp, Pro grosszuegig. */
export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: {
    plan: "free",
    maxVillas: 3,
    monthlyTokenBudget: 50_000,
    maxConcurrentRuns: 1,
    tierName: "Free",
  },
  pro: {
    plan: "pro",
    maxVillas: 25,
    monthlyTokenBudget: 2_000_000,
    maxConcurrentRuns: 8,
    tierName: "Pro",
  },
};

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionState = Pick<
  Subscription,
  "plan" | "status" | "trialEndsAt" | "currentPeriodEnd" | "graceEndsAt" | "cancelAtPeriodEnd"
> & { userId: number };

/**
 * Startzustand: 14-taegiger Pro-Trial mit vollem Funktionsumfang —
 * das Onboarding zeigt sofort das komplette Produkt (Sprint 018-Logik:
 * ensureStarter stellt die Villa, hier den Trial).
 */
export function initialSubscription(userId: number, now = new Date()): SubscriptionState {
  return {
    userId,
    plan: "pro",
    status: "trial",
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
    currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
  };
}

/**
 * Reine Zustandsmaschine: wendet zeitabhaengige Übergänge an.
 * Wird bei jedem Statusabruf ausgefuehrt (expireIfNeeded).
 */
export function transitionSubscription(
  state: SubscriptionState,
  now = new Date()
): SubscriptionState {
  let next: SubscriptionState = { ...state };

  // Trial abgelaufen -> Free (kein Auto-Abzug, bewusst ohne Karte).
  if (next.status === "trial" && next.trialEndsAt && next.trialEndsAt.getTime() <= now.getTime()) {
    next = {
      ...next,
      plan: "free",
      status: "expired",
      currentPeriodEnd: now,
    };
  }

  // Kuendigung zum Periodenende -> Grace-Fenster.
  if (
    next.status === "active" &&
    next.cancelAtPeriodEnd &&
    next.currentPeriodEnd &&
    next.currentPeriodEnd.getTime() <= now.getTime()
  ) {
    next = {
      ...next,
      plan: "free",
      status: "canceled",
      currentPeriodEnd: now,
      graceEndsAt: new Date(now.getTime() + GRACE_DAYS * DAY_MS),
      cancelAtPeriodEnd: false,
    };
  }

  // Grace abgelaufen -> endgueltig expired (Free-Rechte, keine Loeschung).
  if (
    next.status === "canceled" &&
    next.graceEndsAt &&
    next.graceEndsAt.getTime() <= now.getTime()
  ) {
    next = { ...next, status: "expired", graceEndsAt: null };
  }

  // Zahlungsausfall (past_due) mit abgelaufener Grace -> expired.
  if (
    next.status === "past_due" &&
    next.graceEndsAt &&
    next.graceEndsAt.getTime() <= now.getTime()
  ) {
    next = { ...next, plan: "free", status: "expired", graceEndsAt: null };
  }

  return next;
}

/** Effektive Tier-Features: abgelaufener Trial/Canceled liefert Free-Rechte. */
export function effectiveFeatures(state: SubscriptionState): PlanFeatures {
  if (state.status === "expired") return PLAN_FEATURES.free;
  if (state.status === "canceled" || state.status === "past_due") return PLAN_FEATURES.free;
  if (state.status === "trial") return PLAN_FEATURES.pro;
  return PLAN_FEATURES[state.plan];
}

/* ------------------------------------------------------------------ */
/* DB-Glue (villa-store-Muster)                                        */
/* ------------------------------------------------------------------ */

function requireDb() {
  return getDb();
}

/** Subscription eines Nutzers lesen (legt Startzustand an, wenn neu). */
export async function getSubscription(userId: number): Promise<SubscriptionState> {
  const db = (await requireDb())!;
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  let state: SubscriptionState;
  if (rows.length === 0) {
    state = initialSubscription(userId);
    await db.insert(subscriptions).values(state);
  } else {
    const row = rows[0];
    state = {
      userId: row.userId,
      plan: row.plan,
      status: row.status,
      trialEndsAt: row.trialEndsAt,
      currentPeriodEnd: row.currentPeriodEnd,
      graceEndsAt: row.graceEndsAt,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    };
  }
  const next = transitionSubscription(state);
  if (next !== state && rows.length > 0) {
    await persist(userId, next);
  }
  return next;
}

async function persist(userId: number, state: SubscriptionState): Promise<void> {
  const db = (await requireDb())!;
  await db
    .update(subscriptions)
    .set({
      plan: state.plan,
      status: state.status,
      trialEndsAt: state.trialEndsAt,
      currentPeriodEnd: state.currentPeriodEnd,
      graceEndsAt: state.graceEndsAt,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    })
    .where(eq(subscriptions.userId, userId));
}

/**
 * Upgrade auf Pro (Admin oder nach bestandenem Checkout). Startet eine
 * neue Periode (30 Tage); ein laufender Trial wird nahtlos aktiv.
 */
export async function upgradeToPro(
  userId: number,
  now = new Date()
): Promise<SubscriptionState> {
  const state = await getSubscription(userId);
  const next: SubscriptionState = {
    ...state,
    plan: "pro",
    status: "active",
    currentPeriodEnd: new Date(now.getTime() + 30 * DAY_MS),
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
  };
  await persist(userId, next);
  return next;
}

/** Kuendigung zum Periodenende (nie sofort — Fairness-Prinzip). */
export async function cancelAtPeriodEnd(userId: number): Promise<SubscriptionState> {
  const state = await getSubscription(userId);
  const next: SubscriptionState = { ...state, cancelAtPeriodEnd: true };
  await persist(userId, next);
  return next;
}

/** Kuendigung zuruecknehmen. */
export async function resumeSubscription(userId: number): Promise<SubscriptionState> {
  const state = await getSubscription(userId);
  const next: SubscriptionState = { ...state, cancelAtPeriodEnd: false };
  await persist(userId, next);
  return next;
}
