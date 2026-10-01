import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampRunTimeLimitSeconds,
  finishTestRun,
  projectRunProgress,
  setRunPhase,
  startTestRun,
  TestRunError,
} from "./test-run-store";
import { getDb } from "./db";
import { villaTestRuns, villas } from "../drizzle/schema";
import type { Villa, VillaTestRun } from "../drizzle/schema";

vi.mock("./db", async importOriginal => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

const now = new Date("2026-09-30T08:00:00Z");

const villa: Villa = {
  id: 3,
  createdBy: 17,
  name: "Villa Alpha",
  specialty: "Code-Analyse",
  projectBrief: null,
  description: null,
  capacity: 8,
  archivedAt: null,
  projectId: null,
  icon: "bot",
  createdAt: now,
  updatedAt: now,
};

const activeRun: VillaTestRun = {
  id: 11,
  villaId: 3,
  actorId: 17,
  status: "running",
  phase: "planning",
  timeLimitSeconds: 600,
  result: null,
  errorCode: null,
  startedAt: now,
  endedAt: null,
  createdAt: now,
};

const finishedRun: VillaTestRun = {
  ...activeRun,
  id: 12,
  status: "succeeded",
  phase: "result",
  result: { checks: 4 },
  endedAt: new Date("2026-09-30T08:04:00Z"),
};

/**
 * Transaktions-Mock mit Tabellen-Dispatch: Selects auf `villas` liefern
 * villaRows, Selects auf `villaTestRuns` liefern runRows — unabhängig von der
 * Reihenfolge oder Anzahl der Aufrufe innerhalb der Transaktion.
 */
function mockTx(overrides: { villaRows?: Villa[]; runRows?: VillaTestRun[] }) {
  const { villaRows = [villa], runRows = [] } = overrides;
  const tx = {
    select: vi.fn(() => ({
      from: (table: typeof villas | typeof villaTestRuns) => ({
        where: () => ({
          limit: () => ({
            for: async () => (table === villas ? villaRows : runRows),
          }),
          for: async () => (table === villas ? villaRows : runRows),
        }),
      }),
    })),
    insert: vi
      .fn()
      .mockReturnValue({
        values: () => ({ returning: async () => [activeRun] }),
      }),
    update: vi
      .fn()
      .mockReturnValue({
        set: () => ({
          where: () => ({ returning: async () => [finishedRun] }),
        }),
      }),
  };
  vi.mocked(getDb).mockResolvedValue({
    transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as never);
  return tx;
}

describe("startTestRun idempotency (Sprint 022)", () => {
  it("returns the existing active run and inserts nothing on repeated start", async () => {
    const tx = mockTx({ runRows: [activeRun] });
    const run = await startTestRun(3, 17);
    expect(run.id).toBe(11);
    expect(run.status).toBe("running");
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("creates a new run only when no active run exists", async () => {
    const tx = mockTx({ runRows: [] });
    const run = await startTestRun(3, 17);
    expect(run.status).toBe("running");
    expect(tx.insert).toHaveBeenCalledWith(villaTestRuns);
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign villas with NOT_FOUND", async () => {
    mockTx({ villaRows: [] });
    await expect(startTestRun(3, 17)).rejects.toMatchObject({
      reason: "NOT_FOUND",
    });
  });

  it("rejects archived villas with ARCHIVED", async () => {
    mockTx({ villaRows: [{ ...villa, archivedAt: now }] });
    await expect(startTestRun(3, 17)).rejects.toBeInstanceOf(TestRunError);
    await expect(startTestRun(3, 17)).rejects.toMatchObject({
      reason: "ARCHIVED",
    });
  });
});

describe("finishTestRun idempotency (Sprint 022)", () => {
  it("returns an already finished run unchanged when the status matches", async () => {
    const tx = mockTx({ runRows: [finishedRun] });
    const run = await finishTestRun({
      runId: 12,
      userId: 17,
      status: "succeeded",
    });
    expect(run).toBe(finishedRun);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("throws STATUS_MISMATCH when a finished run should switch status", async () => {
    const tx = mockTx({ runRows: [finishedRun] });
    await expect(
      finishTestRun({ runId: 12, userId: 17, status: "cancelled" })
    ).rejects.toMatchObject({ reason: "STATUS_MISMATCH" });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("finishes a running run exactly once with persisted end time", async () => {
    const tx = mockTx({ runRows: [activeRun] });
    const run = await finishTestRun({
      runId: 11,
      userId: 17,
      status: "succeeded",
      result: { checks: 4 },
    });
    expect(run.status).toBe("succeeded");
    expect(tx.update).toHaveBeenCalledWith(villaTestRuns);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign runs with NOT_FOUND", async () => {
    mockTx({ runRows: [] });
    await expect(
      finishTestRun({ runId: 12, userId: 17, status: "succeeded" })
    ).rejects.toMatchObject({ reason: "NOT_FOUND" });
  });
});

describe("setRunPhase (Sprint 023 — Phasenmodell)", () => {
  it("returns the run unchanged when the phase is already set (idempotent)", async () => {
    const tx = mockTx({ runRows: [activeRun] });
    const run = await setRunPhase({ runId: 11, userId: 17, phase: "planning" });
    expect(run).toBe(activeRun);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("advances exactly one step forward and persists the phase", async () => {
    const tx = mockTx({ runRows: [{ ...activeRun, phase: "preparation" }] });
    const updated = { ...activeRun, phase: "planning" };
    tx.update.mockImplementation(
      () =>
        ({
          set: (patch: Record<string, unknown>) => {
            expect(patch).toEqual({ phase: "planning" });
            return {
              where: () => ({ returning: async () => [updated] }),
            };
          },
        }) as never
    );
    const run = await setRunPhase({
      runId: 11,
      userId: 17,
      phase: "planning",
    });
    expect(run.phase).toBe("planning");
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("rejects skipping a phase (preparation -> execution)", async () => {
    const tx = mockTx({ runRows: [{ ...activeRun, phase: "preparation" }] });
    await expect(
      setRunPhase({ runId: 11, userId: 17, phase: "execution" })
    ).rejects.toMatchObject({ reason: "PHASE_MISMATCH" });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects going backwards (execution -> planning)", async () => {
    const tx = mockTx({ runRows: [{ ...activeRun, phase: "execution" }] });
    await expect(
      setRunPhase({ runId: 11, userId: 17, phase: "planning" })
    ).rejects.toMatchObject({ reason: "PHASE_MISMATCH" });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects phase changes on finished runs — history is never rewritten", async () => {
    const tx = mockTx({ runRows: [finishedRun] });
    await expect(
      setRunPhase({ runId: 12, userId: 17, phase: "review" })
    ).rejects.toMatchObject({ reason: "PHASE_MISMATCH" });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects foreign runs with NOT_FOUND", async () => {
    mockTx({ runRows: [] });
    await expect(
      setRunPhase({ runId: 99, userId: 17, phase: "planning" })
    ).rejects.toMatchObject({ reason: "NOT_FOUND" });
  });
});

describe("phase lifecycle (Sprint 023)", () => {
  it("starts new runs in the preparation phase", async () => {
    let erfasst: Record<string, unknown> | undefined;
    const tx = mockTx({ runRows: [] });
    tx.insert.mockImplementation(
      () =>
        ({
          values: (werte: Record<string, unknown>) => {
            erfasst = werte;
            return { returning: async () => [activeRun] };
          },
        }) as never
    );
    await startTestRun(3, 17);
    expect(erfasst).toMatchObject({
      villaId: 3,
      actorId: 17,
      status: "running",
      phase: "preparation",
    });
  });

  it("finishes runs into the system phase result", async () => {
    let patch: Record<string, unknown> | undefined;
    const tx = mockTx({ runRows: [activeRun] });
    tx.update.mockImplementation(
      () =>
        ({
          set: (werte: Record<string, unknown>) => {
            patch = werte;
            return {
              where: () => ({ returning: async () => [finishedRun] }),
            };
          },
        }) as never
    );
    await finishTestRun({ runId: 11, userId: 17, status: "succeeded" });
    expect(patch).toMatchObject({ status: "succeeded", phase: "result" });
  });
});

describe("Sprint 024 — Zeitgrenzen und deterministischer Fortschritt", () => {
  it("clamps the time limit into the allowed range", () => {
    expect(clampRunTimeLimitSeconds(undefined)).toBe(600);
    expect(clampRunTimeLimitSeconds(30)).toBe(60);
    expect(clampRunTimeLimitSeconds(99999)).toBe(3600);
    expect(clampRunTimeLimitSeconds(123.7)).toBe(124);
  });

  it("computes progress and countdown deterministically from the time limit", () => {
    const now = new Date("2026-10-01T19:00:00Z");
    const run = {
      ...activeRun,
      startedAt: new Date("2026-10-01T18:55:00Z"),
      timeLimitSeconds: 600,
    };
    expect(projectRunProgress(run, now)).toEqual({
      phase: "planning",
      status: "running",
      progressPercent: 50,
      remainingSeconds: 300,
      expired: false,
    });
  });

  it("caps progress at 100 percent and reports expiry after the limit", () => {
    const now = new Date("2026-10-01T19:20:00Z");
    const run = {
      ...activeRun,
      startedAt: new Date("2026-10-01T19:00:00Z"),
      timeLimitSeconds: 600,
    };
    expect(projectRunProgress(run, now)).toEqual({
      phase: "planning",
      status: "running",
      progressPercent: 100,
      remainingSeconds: 0,
      expired: true,
    });
  });

  it("reports finished runs as fully complete without countdown", () => {
    const projection = projectRunProgress(finishedRun, new Date());
    expect(projection).toEqual({
      phase: "result",
      status: "succeeded",
      progressPercent: 100,
      remainingSeconds: null,
      expired: false,
    });
  });

  it("persists the clamped time limit on start", async () => {
    let erfasst: Record<string, unknown> | undefined;
    const tx = mockTx({ runRows: [] });
    tx.insert.mockImplementation(
      () =>
        ({
          values: (werte: Record<string, unknown>) => {
            erfasst = werte;
            return { returning: async () => [activeRun] };
          },
        }) as never
    );
    await startTestRun(3, 17, 99999);
    expect(erfasst).toMatchObject({ timeLimitSeconds: 3600 });
  });
});
