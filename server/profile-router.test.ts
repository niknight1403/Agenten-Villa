import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as store from "./profile-store";
import type { AgentProfile, Villa } from "../drizzle/schema";

vi.mock("./profile-store", async (importOriginal) => {
  const actual = await importOriginal<typeof store>();
  return { ...actual };
});

function createContext(userId = 17): TrpcContext {
  const now = new Date();
  return {
    user: { id: userId, openId: "test-open-id", email: "user@example.com", name: "Test User", loginMethod: "test", role: "user", createdAt: now, updatedAt: now, lastSignedIn: now },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const profile: AgentProfile = {
  id: 9,
  createdBy: 17,
  name: "Repo-Analyst",
  role: "review",
  taskProfile: "Analysiert Repositorys und schlägt Refactorings vor",
  createdAt: new Date(),
  updatedAt: new Date(),
};

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
  profileId: 9,
  icon: "bot",
  createdAt: new Date(),
  updatedAt: new Date(),
};

let caller: ReturnType<typeof appRouter.createCaller>;

beforeEach(() => {
  caller = appRouter.createCaller(createContext());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("profile router (Sprint 016)", () => {
  it("lists only the caller's profiles", async () => {
    const spy = vi.spyOn(store, "listProfiles").mockResolvedValue([profile]);
    const result = await caller.profile.list();
    expect(result).toEqual([profile]);
    expect(spy).toHaveBeenCalledWith(17);
  });

  it("creates a profile with validated role and trimmed task profile", async () => {
    const spy = vi.spyOn(store, "createProfile").mockResolvedValue(profile);
    const created = await caller.profile.create({
      name: "  Repo-Analyst  ",
      role: "review",
      taskProfile: "  Analysiert Repositorys  ",
    });
    expect(created.name).toBe("Repo-Analyst");
    expect(spy).toHaveBeenCalledWith({
      createdBy: 17,
      name: "Repo-Analyst",
      role: "review",
      taskProfile: "Analysiert Repositorys",
    });
    const defaultCall = vi.spyOn(store, "createProfile");
    await caller.profile.create({ name: "Ohne Rolle" });
    expect(defaultCall).toHaveBeenCalledWith(
      expect.objectContaining({ role: "entwicklung" })
    );
  });

  it("rejects invalid roles and over-long inputs", async () => {
    await expect(
      caller.profile.create({ name: "X", role: "superheld" as never })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.profile.create({ name: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.profile.create({ name: "x".repeat(81) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.profile.create({ name: "Ok", taskProfile: "x".repeat(2001) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("updates profiles with ownership and maps misses to NOT_FOUND", async () => {
    const spy = vi.spyOn(store, "updateProfile").mockResolvedValue({
      ...profile,
      name: "Repo-Analyst 2",
    });
    const updated = await caller.profile.update({ id: 9, name: "Repo-Analyst 2" });
    expect(updated.name).toBe("Repo-Analyst 2");
    expect(spy).toHaveBeenCalledWith(9, 17, {
      name: "Repo-Analyst 2",
      role: undefined,
      taskProfile: undefined,
    });
    spy.mockResolvedValue(undefined);
    await expect(caller.profile.update({ id: 99, name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("removes only owned profiles", async () => {
    const spy = vi.spyOn(store, "deleteProfile").mockResolvedValue(true);
    const result = await caller.profile.remove({ id: 9 });
    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalledWith(9, 17);
    spy.mockResolvedValue(false);
    await expect(caller.profile.remove({ id: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("assigns a profile to an owned villa and blocks foreign access", async () => {
    const spy = vi.spyOn(store, "assignProfileToVilla").mockResolvedValue(villa);
    const result = await caller.profile.assign({ villaId: 3, profileId: 9 });
    expect(result.profileId).toBe(9);
    expect(spy).toHaveBeenCalledWith(3, 9, 17);
    spy.mockResolvedValue({ ...villa, profileId: null });
    const cleared = await caller.profile.assign({ villaId: 3, profileId: null });
    expect(cleared.profileId).toBeNull();
    expect(spy).toHaveBeenCalledWith(3, null, 17);
    spy.mockResolvedValue(undefined);
    const otherCaller = appRouter.createCaller(createContext(42));
    await expect(
      otherCaller.profile.assign({ villaId: 3, profileId: 9 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps database outages to a clear service error", async () => {
    vi.spyOn(store, "listProfiles").mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    await expect(caller.profile.list()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
