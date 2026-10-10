/**
 * Sprint 103 — Tests: SaaS-Subscription-Lifecycle, Token-Abrechnung
 * und Paywall (Master-Prompt Abschnitt 2.2).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TRIAL_DAYS,
  GRACE_DAYS,
  PLAN_FEATURES,
  effectiveFeatures,
  initialSubscription,
  transitionSubscription,
  type SubscriptionState,
} from "./subscription";
import {
  PaywallError,
  assertTokenBudget,
  checkoutAvailability,
  currentPeriod,
  planCatalog,
  summarizeUsage,
} from "./billing";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_CHECKOUT_APPROVED;
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_CHECKOUT_APPROVED;
});

function trialState(now = new Date(0)): SubscriptionState {
  return initialSubscription(42, now);
}

describe("Subscription-Lifecycle", () => {
  it("startet mit 14-taegigem Pro-Trial", () => {
    const state = trialState();
    expect(state.plan).toBe("pro");
    expect(state.status).toBe("trial");
    expect(state.trialEndsAt!.getTime()).toBe(TRIAL_DAYS * DAY);
    expect(effectiveFeatures(state).tierName).toBe("Pro");
  });

  it("laeuft nach Trial-Ablauf automatisch auf Free/expired", () => {
    const state = trialState();
    const after = transitionSubscription(state, new Date((TRIAL_DAYS + 1) * DAY));
    expect(after.plan).toBe("free");
    expect(after.status).toBe("expired");
    expect(effectiveFeatures(after)).toEqual(PLAN_FEATURES.free);
  });

  it("bleibt im Trial aktiv, solange er laeuft", () => {
    const state = trialState();
    const after = transitionSubscription(state, new Date((TRIAL_DAYS - 1) * DAY));
    expect(after.status).toBe("trial");
  });

  it("aktive Pro-Subscription mit Kuendigung bleibt bis Periodenende aktiv", () => {
    const state: SubscriptionState = {
      ...trialState(),
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date(30 * DAY),
      cancelAtPeriodEnd: true,
    };
    const before = transitionSubscription(state, new Date(29 * DAY));
    expect(before.status).toBe("active");
    expect(before.plan).toBe("pro");
  });

  it("wechselt nach Periodenende in die 7-taegige Grace-Phase auf Free", () => {
    const state: SubscriptionState = {
      ...trialState(),
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date(30 * DAY),
      cancelAtPeriodEnd: true,
    };
    const after = transitionSubscription(state, new Date(31 * DAY));
    expect(after.status).toBe("canceled");
    expect(after.plan).toBe("free");
    expect(after.graceEndsAt!.getTime()).toBe(31 * DAY + GRACE_DAYS * DAY);
  });

  it("wird nach Grace endgueltig expired", () => {
    const state: SubscriptionState = {
      ...trialState(),
      plan: "free",
      status: "canceled",
      currentPeriodEnd: new Date(30 * DAY),
      graceEndsAt: new Date(37 * DAY),
    };
    const after = transitionSubscription(state, new Date(38 * DAY));
    expect(after.status).toBe("expired");
    expect(after.graceEndsAt).toBeNull();
  });

  it("laesst past_due nach Grace auf Free/expired fallen", () => {
    const state: SubscriptionState = {
      ...trialState(),
      plan: "pro",
      status: "past_due",
      graceEndsAt: new Date(37 * DAY),
    };
    const after = transitionSubscription(state, new Date(38 * DAY));
    expect(after.status).toBe("expired");
    expect(after.plan).toBe("free");
  });
});

describe("Token-Abrechnung & Paywall", () => {
  it("bildet die Periode korrekt (YYYY-MM, UTC)", () => {
    expect(currentPeriod(new Date("2026-10-10T23:30:00Z"))).toBe("2026-10");
    expect(currentPeriod(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });

  it("zusammenfassung im Tier-Budget bleibt paywall-frei", () => {
    const state = trialState();
    const summary = summarizeUsage(state, 10_000);
    expect(summary.tierName).toBe("Pro");
    expect(summary.tokenBudget).toBe(2_000_000);
    expect(summary.percentUsed).toBe(1);
    expect(summary.quotaExceeded).toBe(false);
  });

  it("Budget-Ueberschreitung loest die Paywall aus", () => {
    const state: SubscriptionState = { ...trialState(), plan: "free", status: "expired" };
    const summary = summarizeUsage(state, 60_000);
    expect(summary.quotaExceeded).toBe(true);
    expect(() => assertTokenBudget(state, 60_000)).toThrow(PaywallError);
    expect(() => assertTokenBudget(state, 49_999)).not.toThrow();
  });

  it("Free-Tier hat 50k Budget, Pro 2M", () => {
    expect(PLAN_FEATURES.free.monthlyTokenBudget).toBe(50_000);
    expect(PLAN_FEATURES.pro.monthlyTokenBudget).toBe(2_000_000);
  });

  it("percentUsed deckelt bei 100 %", () => {
    const state: SubscriptionState = { ...trialState(), plan: "free", status: "expired" };
    const summary = summarizeUsage(state, 500_000);
    expect(summary.percentUsed).toBe(100);
  });
});

describe("Checkout-Gate", () => {
  it("ohne Stripe-Keys: nicht verfuegbar, Admin-Freigabe noetig", () => {
    const result = checkoutAvailability();
    expect(result.available).toBe(false);
    expect(result.requiresAdminApproval).toBe(true);
  });

  it("mit Keys, ohne getrennte Freigabe: weiterhin gesperrt", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const result = checkoutAvailability();
    expect(result.available).toBe(false);
    expect(result.requiresAdminApproval).toBe(true);
  });

  it("erst Keys + ausdrueckliche Freigabe schalten den Checkout frei", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_CHECKOUT_APPROVED = "true";
    const result = checkoutAvailability();
    expect(result.available).toBe(true);
    expect(result.requiresAdminApproval).toBe(false);
  });

  it("Tier-Katalog zeigt beide Plaene", () => {
    const catalog = planCatalog();
    expect(catalog.plans.map((p) => p.plan)).toEqual(["free", "pro"]);
  });
});
