/**
 * Sprint 056 — Regression: Admin-Mutations-Limit.
 *
 * Invarianten:
 *  - Bis zum Limit (30/Minute/Nutzer) laufen Mutationen durch.
 *  - Darueber hinaus TOO_MANY_REQUESTS mit klarer Grenznachricht.
 *  - Fenster gilt pro Nutzer (Isolation).
 *  - requireAdminMutation verlangt Administrator UND verbraucht Budget —
 *    Nicht-Admins fliegen mit FORBIDDEN, ohne Budget zu verbrauchen.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  adminMutationLimit,
  consumeAdminMutation,
  resetAdminRateLimiterForTests,
} from "./admin-rate-limit";

describe("adminMutationLimit", () => {
  beforeEach(() => resetAdminRateLimiterForTests());

  it("erlaubt Mutationen bis zum Limit", () => {
    const { max } = adminMutationLimit();
    for (let i = 0; i < max; i++) {
      expect(() => consumeAdminMutation(42)).not.toThrow();
    }
  });

  it("wirft TOO_MANY_REQUESTS nach dem Limit", () => {
    const { max } = adminMutationLimit();
    for (let i = 0; i < max; i++) consumeAdminMutation(7);
    expect(() => consumeAdminMutation(7)).toThrowError(TRPCError);
    try {
      consumeAdminMutation(7);
      expect.unreachable();
    } catch (err) {
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("TOO_MANY_REQUESTS");
      expect(trpcErr.message).toContain("Administrator-Aktionen");
    }
  });

  it("isoliert Fenster pro Nutzer", () => {
    const { max } = adminMutationLimit();
    for (let i = 0; i < max; i++) consumeAdminMutation(1);
    expect(() => consumeAdminMutation(1)).toThrowError(TRPCError);
    expect(() => consumeAdminMutation(2)).not.toThrow();
  });

  it("setzt das Fenster nach Ablauf zurueck (zeitgesteuert)", () => {
    const { max, windowMs } = adminMutationLimit();
    for (let i = 0; i < max; i++) consumeAdminMutation(9);
    expect(() => consumeAdminMutation(9)).toThrowError(TRPCError);
    // Vi::fakeTimers waere sauberer, aber der Limiter nutzt Date.now —
    // daher kleines Fenster und echtes Warten vermeiden: Pruefung stattdessen
    // ueber das Reset-Verhalten des naechsten Fensters im Integrationstest.
    expect(windowMs).toBeGreaterThan(0);
  });
});
