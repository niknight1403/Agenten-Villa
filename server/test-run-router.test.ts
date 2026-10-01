import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as store from "./test-run-store";
import type { VillaTestRun } from "../drizzle/schema";

vi.mock("./test-run-store", async importOriginal => {
  const actual = await importOriginal<typeof store>();
  return { ...actual };
});

function createContext(userId = 17): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: userId,
      openId: "test-open-id",
      email: "user@example.com",
      name: "Test User",
      loginMethod: "test",
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const runningRun: VillaTestRun = {
  id: 11,
  villaId: 3,
  actorId: 17,
  status: "running",
  phase: "planning",
  timeLimitSeconds: 600,
  result: null,
  errorCode: null,
  startedAt: new Date("2026-09-30T08:00:00Z"),
  endedAt: null,
  createdAt: new Date("2026-09-30T08:00:00Z"),
};

const succeededRun: VillaTestRun = {
  ...runningRun,
  id: 12,
  status: "succeeded",
  phase: "result",
  result: { checks: 4, failed: 0 },
  endedAt: new Date("2026-09-30T08:04:00Z"),
};

let caller: ReturnType<typeof appRouter.createCaller>;

beforeEach(() => {
  caller = appRouter.createCaller(createContext());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("run router (Sprint 021/022)", () => {
  it("lists only the caller's runs, newest first, bounded by limit", async () => {
    const spy = vi
      .spyOn(store, "listTestRuns")
      .mockResolvedValue([succeededRun, runningRun]);
    const result = await caller.run.list({ villaId: 3, limit: 20 });
    expect(result).toEqual([succeededRun, runningRun]);
    expect(spy).toHaveBeenCalledWith(17, 3, 20);
    await caller.run.list();
    expect(spy).toHaveBeenLastCalledWith(17, undefined, undefined);
  });

  it("rejects invalid list input", async () => {
    await expect(caller.run.list({ villaId: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.run.list({ limit: 51 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("starts a persisted run for an owned villa", async () => {
    const spy = vi.spyOn(store, "startTestRun").mockResolvedValue(runningRun);
    const run = await caller.run.start({ villaId: 3 });
    expect(run.status).toBe("running");
    expect(run.endedAt).toBeNull();
    expect(spy).toHaveBeenCalledWith(3, 17, undefined, undefined);
  });

  it("maps foreign villas to NOT_FOUND", async () => {
    vi.spyOn(store, "startTestRun").mockRejectedValue(
      new store.TestRunError("NOT_FOUND")
    );
    await expect(caller.run.start({ villaId: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("maps archived villas to FORBIDDEN", async () => {
    vi.spyOn(store, "startTestRun").mockRejectedValue(
      new store.TestRunError("ARCHIVED")
    );
    await expect(caller.run.start({ villaId: 3 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("finishes a run with persisted status, end time and result", async () => {
    const spy = vi
      .spyOn(store, "finishTestRun")
      .mockResolvedValue(succeededRun);
    const run = await caller.run.finish({
      runId: 12,
      status: "succeeded",
      result: { checks: 4, failed: 0 },
    });
    expect(run.status).toBe("succeeded");
    expect(run.endedAt).not.toBeNull();
    expect(spy).toHaveBeenCalledWith({
      runId: 12,
      userId: 17,
      status: "succeeded",
      result: { checks: 4, failed: 0 },
      errorCode: undefined,
    });
  });

  it("rejects running as finish status and oversized results", async () => {
    await expect(
      caller.run.finish({ runId: 12, status: "running" as never })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const oversized = { blob: "x".repeat(25_000) };
    await expect(
      caller.run.finish({ runId: 12, status: "succeeded", result: oversized })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps status changes on finished runs to CONFLICT", async () => {
    vi.spyOn(store, "finishTestRun").mockRejectedValue(
      new store.TestRunError("STATUS_MISMATCH")
    );
    await expect(
      caller.run.finish({ runId: 12, status: "failed" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reads a single run only if owned", async () => {
    const spy = vi.spyOn(store, "getTestRun").mockResolvedValue(succeededRun);
    const run = await caller.run.get({ runId: 12 });
    expect(run.id).toBe(12);
    expect(spy).toHaveBeenCalledWith(12, 17);
    spy.mockResolvedValue(undefined);
    await expect(caller.run.get({ runId: 13 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("maps database outages to SERVICE_UNAVAILABLE", async () => {
    vi.spyOn(store, "listTestRuns").mockRejectedValue(
      new Error("DATABASE_UNAVAILABLE")
    );
    await expect(caller.run.list()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("run.setPhase (Sprint 023 — Phasenmodell)", () => {
  it("advances the phase of a running run for its owner", async () => {
    const spy = vi
      .spyOn(store, "setRunPhase")
      .mockResolvedValue({ ...runningRun, phase: "execution" });
    const result = await caller.run.setPhase({
      runId: 11,
      phase: "execution",
    });
    expect(result.phase).toBe("execution");
    expect(spy).toHaveBeenCalledWith({
      runId: 11,
      userId: 17,
      phase: "execution",
    });
  });

  it("maps PHASE_MISMATCH to a CONFLICT conflict, history stays intact", async () => {
    vi.spyOn(store, "setRunPhase").mockRejectedValue(
      new store.TestRunError("PHASE_MISMATCH")
    );
    await expect(
      caller.run.setPhase({ runId: 12, phase: "review" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps NOT_FOUND for foreign runs", async () => {
    vi.spyOn(store, "setRunPhase").mockRejectedValue(
      new store.TestRunError("NOT_FOUND")
    );
    await expect(
      caller.run.setPhase({ runId: 99, phase: "planning" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects the system phase result as user input", async () => {
    const spy = vi.spyOn(store, "setRunPhase");
    await expect(
      caller.run.setPhase({ runId: 11, phase: "result" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("run.progress (Sprint 024 — Countdown und Fortschritt)", () => {
  it("projects deterministic progress for an owned running run", async () => {
    vi.spyOn(store, "getTestRun").mockResolvedValue(runningRun);
    const spy = vi
      .spyOn(store, "projectRunProgress")
      .mockReturnValue({
        phase: "planning",
        status: "running",
        progressPercent: 50,
        remainingSeconds: 300,
        expired: false,
      });
    const result = await caller.run.progress({ runId: 11 });
    expect(result.progressPercent).toBe(50);
    expect(result.remainingSeconds).toBe(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects progress for foreign runs with NOT_FOUND", async () => {
    vi.spyOn(store, "getTestRun").mockResolvedValue(undefined);
    await expect(caller.run.progress({ runId: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects time limits outside the allowed range at start", async () => {
    const spy = vi.spyOn(store, "startTestRun");
    await expect(
      caller.run.start({ villaId: 3, timeLimitSeconds: 10 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("starts with an optional time limit within the range", async () => {
    const spy = vi
      .spyOn(store, "startTestRun")
      .mockResolvedValue(runningRun);
    await caller.run.start({ villaId: 3, timeLimitSeconds: 900 });
    expect(spy).toHaveBeenCalledWith(3, 17, 900, undefined);
  });
});

describe("run.log / run.appendEvent (Sprint 025 — Live-Aktivitätsprotokoll)", () => {
  it("lists the last local events for an owned run", async () => {
    const spy = vi
      .spyOn(store, "listRunEvents")
      .mockResolvedValue([
        {
          id: 71,
          runId: 11,
          level: "info",
          message: "Planung abgeschlossen",
          createdAt: new Date("2026-10-01T19:01:00Z"),
        },
      ]);
    const events = await caller.run.log({ runId: 11, limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Planung abgeschlossen");
    expect(spy).toHaveBeenCalledWith(11, 17, 10);
  });

  it("appends an event and returns it", async () => {
    const spy = vi.spyOn(store, "appendRunEvent").mockResolvedValue({
      id: 72,
      runId: 11,
      level: "warn",
      message: "Rate-Limit beobachtet",
      createdAt: new Date("2026-10-01T19:02:00Z"),
    });
    const event = await caller.run.appendEvent({
      runId: 11,
      level: "warn",
      message: "Rate-Limit beobachtet",
    });
    expect(event.level).toBe("warn");
    expect(spy).toHaveBeenCalledWith({
      runId: 11,
      userId: 17,
      level: "warn",
      message: "Rate-Limit beobachtet",
    });
  });

  it("maps STATUS_MISMATCH on finished runs to CONFLICT", async () => {
    vi.spyOn(store, "appendRunEvent").mockRejectedValue(
      new store.TestRunError("STATUS_MISMATCH")
    );
    await expect(
      caller.run.appendEvent({ runId: 12, level: "info", message: "zu spät" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects empty and oversized messages", async () => {
    const spy = vi.spyOn(store, "appendRunEvent");
    await expect(
      caller.run.appendEvent({ runId: 11, level: "info", message: "" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.run.appendEvent({
        runId: 11,
        level: "info",
        message: "x".repeat(401),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("run.finish mit Abbruchgrund (Sprint 026)", () => {
  it("passes the cancellation kind through to the store", async () => {
    const spy = vi
      .spyOn(store, "finishTestRun")
      .mockResolvedValue({
        ...runningRun,
        status: "cancelled",
        phase: "result",
        cancellationKind: "technical",
        endedAt: new Date("2026-10-01T19:05:00Z"),
      });
    const run = await caller.run.finish({
      runId: 11,
      status: "cancelled",
      cancellationKind: "technical",
    });
    expect(run.cancellationKind).toBe("technical");
    expect(spy).toHaveBeenCalledWith({
      runId: 11,
      userId: 17,
      status: "cancelled",
      cancellationKind: "technical",
    });
  });

  it("rejects invalid cancellation kinds at the schema level", async () => {
    const spy = vi.spyOn(store, "finishTestRun");
    await expect(
      caller.run.finish({
        runId: 11,
        status: "cancelled",
        cancellationKind: "sonstwas",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps CANCEL_KIND_MISMATCH to CONFLICT", async () => {
    vi.spyOn(store, "finishTestRun").mockRejectedValue(
      new store.TestRunError("CANCEL_KIND_MISMATCH")
    );
    await expect(
      caller.run.finish({
        runId: 11,
        status: "succeeded",
        cancellationKind: "manual",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("run.releaseForResume / Wiederaufnahme (Sprint 027)", () => {
  it("releases an owned aborted run for resume", async () => {
    const spy = vi.spyOn(store, "releaseRunForResume").mockResolvedValue({
      ...runningRun,
      id: 13,
      status: "cancelled",
      phase: "result",
      cancellationKind: "technical",
      releasedForResumeAt: new Date("2026-10-01T19:10:00Z"),
    });
    const run = await caller.run.releaseForResume({ runId: 13 });
    expect(run.releasedForResumeAt).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ runId: 13, userId: 17 });
  });

  it("maps NOT_RELEASED to CONFLICT — resume without release is a conflict", async () => {
    vi.spyOn(store, "startTestRun").mockRejectedValue(
      new store.TestRunError("NOT_RELEASED")
    );
    await expect(
      caller.run.start({ villaId: 3, resumeOfRunId: 13 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("passes resumeOfRunId through on start", async () => {
    const spy = vi.spyOn(store, "startTestRun").mockResolvedValue(runningRun);
    await caller.run.start({ villaId: 3, resumeOfRunId: 13 });
    expect(spy).toHaveBeenCalledWith(3, 17, undefined, 13);
  });

  it("rejects non-positive run ids for release at the schema level", async () => {
    const spy = vi.spyOn(store, "releaseRunForResume");
    await expect(
      caller.run.releaseForResume({ runId: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(spy).not.toHaveBeenCalled();
  });
});
