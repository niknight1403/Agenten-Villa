import { afterEach, describe, expect, it, vi } from "vitest";
import { finishTestRun, startTestRun, TestRunError } from "./test-run-store";
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
