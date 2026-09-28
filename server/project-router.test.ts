import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as store from "./project-store";
import type { Project, Villa } from "../drizzle/schema";

vi.mock("./project-store", async (importOriginal) => {
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

const project: Project = {
  id: 5,
  createdBy: 17,
  name: "Dateimanager",
  brief: "Android-Dateimanager mit Speicheranalyse",
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
  projectId: 5,
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

describe("project router (Sprint 015)", () => {
  it("lists only the caller's projects", async () => {
    const spy = vi.spyOn(store, "listProjects").mockResolvedValue([project]);
    const result = await caller.project.list();
    expect(result).toEqual([project]);
    expect(spy).toHaveBeenCalledWith(17);
  });

  it("creates a project with trimmed name and optional brief", async () => {
    const spy = vi.spyOn(store, "createProject").mockResolvedValue(project);
    const created = await caller.project.create({
      name: "  Dateimanager  ",
      brief: "  Android-Dateimanager  ",
    });
    expect(created.name).toBe("Dateimanager");
    expect(spy).toHaveBeenCalledWith({
      createdBy: 17,
      name: "Dateimanager",
      brief: "Android-Dateimanager",
    });
  });

  it("rejects empty, over-long names and briefs", async () => {
    await expect(caller.project.create({ name: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.project.create({ name: "x".repeat(81) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.project.create({ name: "Ok", brief: "x".repeat(2001) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("assigns a project to an owned villa and passes ownership through", async () => {
    const spy = vi.spyOn(store, "assignProjectToVilla").mockResolvedValue(villa);
    const result = await caller.project.assign({ villaId: 3, projectId: 5 });
    expect(result.projectId).toBe(5);
    expect(spy).toHaveBeenCalledWith(3, 5, 17);
    spy.mockResolvedValue({ ...villa, projectId: null });
    const unassigned = await caller.project.assign({ villaId: 3, projectId: null });
    expect(unassigned.projectId).toBeNull();
    expect(spy).toHaveBeenCalledWith(3, null, 17);
  });

  it("maps foreign or missing villas/projects to NOT_FOUND", async () => {
    vi.spyOn(store, "assignProjectToVilla").mockResolvedValue(undefined);
    await expect(
      caller.project.assign({ villaId: 99, projectId: 5 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const otherCaller = appRouter.createCaller(createContext(42));
    await expect(
      otherCaller.project.assign({ villaId: 3, projectId: 5 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps database outages to a clear service error", async () => {
    vi.spyOn(store, "listProjects").mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    await expect(caller.project.list()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
