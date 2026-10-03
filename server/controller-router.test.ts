import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { villaController } from "./controller";
import type { ControllerState } from "./controller";

function createContext(userId = 17, role: "user" | "admin" = "user"): TrpcContext {
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

const state: ControllerState = {
  status: "STOPPED",
  startedAt: null,
  stoppedAt: null,
  activeWorkers: 0,
  savedAt: null,
  tickCount: 0,
  lastTickAt: null,
  lastReport: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("controller-Berechtigungen (Sprint 029)", () => {
  it("lets any authenticated user read the global status", async () => {
    const spy = vi
      .spyOn(villaController, "getState")
      .mockReturnValue({ ...state, status: "RUNNING", activeWorkers: 2 });
    const caller = appRouter.createCaller(createContext(17, "user"));
    const result = await caller.controller.getStatus();
    expect(result.status).toBe("RUNNING");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("forbids global controls for non-admins — nothing is invoked", async () => {
    const start = vi.spyOn(villaController, "start").mockResolvedValue(state);
    const stop = vi.spyOn(villaController, "stop").mockResolvedValue(state);
    const caller = appRouter.createCaller(createContext(17, "user"));
    await expect(caller.controller.start()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.controller.stop()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.controller.toggle()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("lets administrators start and stop the global controller", async () => {
    const start = vi
      .spyOn(villaController, "start")
      .mockResolvedValue({ ...state, status: "RUNNING" });
    const stop = vi
      .spyOn(villaController, "stop")
      .mockResolvedValue({ ...state, status: "STOPPED" });
    const admin = appRouter.createCaller(createContext(1, "admin"));
    expect((await admin.controller.start()).status).toBe("RUNNING");
    expect((await admin.controller.stop()).status).toBe("STOPPED");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("toggles based on the current status — RUNNING stops, else starts", async () => {
    const start = vi
      .spyOn(villaController, "start")
      .mockResolvedValue({ ...state, status: "RUNNING" });
    const stop = vi
      .spyOn(villaController, "stop")
      .mockResolvedValue({ ...state, status: "STOPPED" });
    const getState = vi
      .spyOn(villaController, "getState")
      .mockReturnValueOnce({ ...state, status: "RUNNING" })
      .mockReturnValueOnce({ ...state, status: "STOPPED" });
    const admin = appRouter.createCaller(createContext(1, "admin"));
    expect((await admin.controller.toggle()).status).toBe("STOPPED");
    expect((await admin.controller.toggle()).status).toBe("RUNNING");
    expect(getState).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
