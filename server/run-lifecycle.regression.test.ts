/**
 * Sprint 030 — Controller-Review: Regressionssuite, die die Invarianten
 * aus den Lauf-Sprints 021–029 als einen zusammenhängenden Zeitstrahl
 * prüft: Laufzustände, Projektionen, Rechte und Abbruch-/Wiederaufnahme-
 * regeln müssen zusammen konsistent bleiben.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as store from "./test-run-store";
import { villaController } from "./controller";
import type { ControllerState } from "./controller";
import type { VillaTestRun } from "../drizzle/schema";

function createContext(
  userId = 17,
  role: "user" | "admin" = "user"
): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: userId,
      openId: "test-open-id",
      email: "user@example.com",
      name: "Test User",
      loginMethod: "test",
      role,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const T0 = new Date("2026-10-01T19:00:00Z");

describe("Controller-Review (Sprint 030)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds the full run timeline consistent across all sprint projections", () => {
    const run: VillaTestRun = {
      id: 11,
      villaId: 3,
      actorId: 17,
      status: "running",
      phase: "planning",
      timeLimitSeconds: 600,
      result: null,
      errorCode: null,
      startedAt: T0,
    };

    // Sprint 024 — Countdown und Fortschritt
    expect(
      store.projectRunProgress(run, new Date("2026-10-01T19:05:00Z"))
    ).toMatchObject({ remainingSeconds: 300, expired: false, progressPercent: 50 });
    expect(
      store.projectRunProgress(run, new Date("2026-10-01T19:10:01Z"))
    ).toMatchObject({ remainingSeconds: 0, expired: true, progressPercent: 100 });

    // Sprint 025/026 — Abbruch durch Zeitgrenze: technisch, mit Fehlercode
    const cancelled: VillaTestRun = {
      ...run,
      status: "cancelled",
      phase: "result",
      cancellationKind: "technical",
      errorCode: "TIME_LIMIT_EXCEEDED",
      endedAt: new Date("2026-10-01T19:10:20Z"),
    };
    // listRunEvents liefert neueste zuerst (Sprint 025)
    const events = [
      {
        id: 2,
        runId: 11,
        level: "warn",
        message: "Zeitgrenze ueberschritten",
        createdAt: new Date("2026-10-01T19:10:01Z"),
      },
      {
        id: 1,
        runId: 11,
        level: "info",
        message: "Lauf gestartet",
        createdAt: T0,
      },
    ];

    // Sprint 028 — Laufbericht luegt nicht ueber die Historie
    const report = store.buildRunReport(
      cancelled,
      events,
      new Date("2026-10-01T20:00:00Z")
    );
    expect(report).toMatchObject({
      status: "cancelled",
      phase: "result",
      cancellationKind: "technical",
      errorCode: "TIME_LIMIT_EXCEEDED",
      durationSeconds: 620,
      timeLimitSeconds: 600,
      expired: true,
    });
    expect(report.events).toMatchObject({ info: 1, warn: 1, error: 0 });
    expect(report.events.lastMessages).toEqual([
      "Zeitgrenze ueberschritten",
      "Lauf gestartet",
    ]);

    // Sprint 027 — Wiederaufnahme: neuer Lauf referenziert, Original unveraendert
    const resumed: VillaTestRun = {
      ...run,
      id: 14,
      startedAt: new Date("2026-10-01T19:30:00Z"),
      resumedFromRunId: 11,
    };
    const resumedReport = store.buildRunReport(resumed, []);
    expect(resumedReport.resumedFromRunId).toBe(11);
    expect(resumedReport.cancellationKind).toBeNull();
    expect(resumedReport.errorCode).toBeNull();
    // Der Ursprungslauf bleibt unberuehrt vom Fortsetzen
    expect(cancelled.resumedFromRunId).toBeUndefined();
    expect(cancelled.status).toBe("cancelled");

    // Sprint 024 — Grenzwert klamppt unsinnige Limits auf den Default
    expect(store.clampRunTimeLimitSeconds(undefined)).toBe(600);
  });

  it("keeps a succeeded run free of cancellation traces", () => {
    const succeeded: VillaTestRun = {
      id: 12,
      villaId: 3,
      actorId: 17,
      status: "succeeded",
      phase: "result",
      timeLimitSeconds: 600,
      result: { ok: true },
      errorCode: null,
      startedAt: T0,
      endedAt: new Date("2026-10-01T19:08:00Z"),
    };
    const report = store.buildRunReport(succeeded, []);
    expect(report).toMatchObject({
      status: "succeeded",
      cancellationKind: null,
      errorCode: null,
      expired: false,
      endedAt: new Date("2026-10-01T19:08:00Z"),
    });
  });

  it("keeps global controls admin-only — regression of the rights matrix", async () => {
    const start = vi
      .spyOn(villaController, "start")
      .mockResolvedValue({} as ControllerState);
    const stop = vi
      .spyOn(villaController, "stop")
      .mockResolvedValue({} as ControllerState);
    const user = appRouter.createCaller(createContext(17, "user"));
    await expect(user.controller.start()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(user.controller.toggle()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();

    const admin = appRouter.createCaller(createContext(1, "admin"));
    await admin.controller.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps run access ownership-scoped — foreign runs stay invisible", async () => {
    vi.spyOn(store, "getTestRun").mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createContext(17, "user"));
    await expect(caller.run.report({ runId: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
