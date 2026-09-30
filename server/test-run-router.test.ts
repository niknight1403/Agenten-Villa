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
    expect(spy).toHaveBeenCalledWith(3, 17);
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
