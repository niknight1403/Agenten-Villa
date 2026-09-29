import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as store from "./villa-store";
import type { Villa, VillaMessage } from "../drizzle/schema";

vi.mock("./villa-store", async (importOriginal) => {
  const actual = await importOriginal<typeof store>();
  return { ...actual };
});

function createContext(userId = 17, role: "user" | "admin" = "user"): TrpcContext {
  const now = new Date();
  return {
    user: { id: userId, openId: "test-open-id", email: "user@example.com", name: "Test User", loginMethod: "test", role, createdAt: now, updatedAt: now, lastSignedIn: now },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const villa: Villa = {
  id: 3,
  createdBy: 17,
  name: "Villa Alpha",
  specialty: "Code-Analyse",
  icon: "bot",
  projectBrief: null,
  description: null,
  capacity: 8,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const message: VillaMessage = {
  id: 11,
  villaId: 3,
  role: "assistant",
  content: "Zusammenfassung",
  provider: "openrouter/free",
  model: "free-test",
  rating: null,
  createdAt: new Date(),
};

let caller: ReturnType<typeof appRouter.createCaller>;

beforeEach(() => {
  caller = appRouter.createCaller(createContext());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("villa router validation and ownership", () => {
  it("lists only the caller's villas", async () => {
    const spy = vi.spyOn(store, "listVillas").mockResolvedValue([villa]);
    const result = await caller.villa.list();
    expect(result).toEqual([villa]);
    expect(spy).toHaveBeenCalledWith(17);
  });

  it("creates a villa with trimmed name, specialty default, and icon", async () => {
    const spy = vi
      .spyOn(store, "createVilla")
      .mockResolvedValue({ ...villa, name: "Villa Beta", specialty: "Neuer Agent" });
    const result = await caller.villa.create({ name: "  Villa Beta  " });
    expect(result.name).toBe("Villa Beta");
    expect(spy).toHaveBeenCalledWith({
      createdBy: 17,
      name: "Villa Beta",
      specialty: "Neuer Agent",
      icon: "bot",
      projectBrief: undefined,
      description: undefined,
      capacity: 8,
    });
  });

  it("rejects empty, over-long, and missing villa names", async () => {
    await expect(caller.villa.create({ name: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.villa.create({ name: "x".repeat(81) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.villa.create({} as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validates capacity and description on create (Sprint 012)", async () => {
    const spy = vi.spyOn(store, "createVilla").mockResolvedValue(villa);
    await caller.villa.create({ name: "Kapazitaetsvilla", capacity: 25, description: "  Kurzbeschreibung  " });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      capacity: 25,
      description: "Kurzbeschreibung",
    }));
    await expect(caller.villa.create({ name: "Null", capacity: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.villa.create({ name: "Zu viel", capacity: 26 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.villa.create({ name: "Bruch", capacity: 2.5 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.villa.create({ name: "Text", description: "x".repeat(1001) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("creates a project villa with a stored brief for its superagent", async () => {
    const spy = vi.spyOn(store, "createVilla").mockResolvedValue({ ...villa, projectBrief: "Baue einen Dateimanager" });
    await caller.villa.create({ name: "Dateimanager-Villa", icon: "villa", specialty: "Autonome Projektentwicklung", projectBrief: "  Baue einen Dateimanager  " });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: 17, icon: "villa", projectBrief: "Baue einen Dateimanager",
    }));
  });


  it("lists only villas of the calling user id (Sprint 011)", async () => {
    const otherCaller = appRouter.createCaller(createContext(42));
    const spy = vi.spyOn(store, "listVillas").mockResolvedValue([]);
    await otherCaller.villa.list();
    expect(spy).toHaveBeenCalledWith(42);
    expect(spy).not.toHaveBeenCalledWith(17);
  });

  it("routes every read and write through the caller id and never leaks foreign villas (Sprint 011)", async () => {
    const otherCaller = appRouter.createCaller(createContext(42));
    const listSpy = vi.spyOn(store, "listMessages").mockResolvedValue([]);
    await expect(otherCaller.villa.messages({ villaId: 3 })).resolves.toEqual([]);
    expect(listSpy).toHaveBeenCalledWith(3, 42);
    const updateSpy = vi.spyOn(store, "updateVilla").mockResolvedValue(undefined);
    await expect(otherCaller.villa.update({ id: 3, name: "Fremd" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(updateSpy).toHaveBeenCalledWith(3, 42, { name: "Fremd", specialty: undefined });
    const villaSpy = vi.spyOn(store, "getVilla").mockResolvedValue(undefined);
    const appendSpy = vi.spyOn(store, "appendMessages").mockResolvedValue([]);
    await expect(
      otherCaller.villa.appendMessages({ villaId: 3, messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(villaSpy).toHaveBeenCalledWith(3, 42);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("maps update misses to NOT_FOUND and passes ownership through", async () => {
    vi.spyOn(store, "updateVilla").mockResolvedValue(undefined);
    await expect(caller.villa.update({ id: 99, name: "Neu" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(store.updateVilla).toHaveBeenCalledWith(99, 17, {
      name: "Neu",
      specialty: undefined,
      description: undefined,
      capacity: undefined,
    });
  });

  it("persists edited fields and exposes an audited event trail (Sprint 013)", async () => {
    const updateSpy = vi.spyOn(store, "updateVilla").mockResolvedValue({
      ...villa,
      name: "Villa Alpha 2",
      capacity: 12,
      description: "Neue Beschreibung",
    });
    const updated = await caller.villa.update({
      id: 3,
      name: "  Villa Alpha 2  ",
      capacity: 12,
      description: "Neue Beschreibung",
    });
    expect(updated.name).toBe("Villa Alpha 2");
    expect(updateSpy).toHaveBeenCalledWith(3, 17, {
      name: "Villa Alpha 2",
      specialty: undefined,
      description: "Neue Beschreibung",
      capacity: 12,
    });
    await expect(
      caller.villa.update({ id: 3, capacity: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.villa.update({ id: 3, description: "x".repeat(1001) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const event = {
      id: 7,
      villaId: 3,
      actorId: 17,
      action: "updated",
      detail: JSON.stringify({ fields: ["capacity"], values: { capacity: 12 } }),
      createdAt: new Date(),
    };
    const eventsSpy = vi.spyOn(store, "listVillaEvents").mockResolvedValue([event]);
    const trail = await caller.villa.events({ villaId: 3 });
    expect(trail).toEqual([event]);
    expect(eventsSpy).toHaveBeenCalledWith(3, 17);
    vi.spyOn(store, "listVillaEvents").mockResolvedValue([]);
    await expect(caller.villa.events({ villaId: 99 })).resolves.toEqual([]);
  });

  it("deletes only existing own villas", async () => {
    const spy = vi.spyOn(store, "deleteVilla").mockResolvedValue(true);
    await expect(caller.villa.remove({ id: 3 })).resolves.toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith(3, 17);
    spy.mockResolvedValue(false);
    await expect(caller.villa.remove({ id: 4 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns messages in chronological order", async () => {
    const userMsg = { ...message, id: 10, role: "user" as const };
    vi.spyOn(store, "listMessages").mockResolvedValue([message, userMsg]);
    const result = await caller.villa.messages({ villaId: 3 });
    expect(result.map((row) => row.id)).toEqual([10, 11]);
  });

  it("appends a bounded batch of messages and requires ownership", async () => {
    vi.spyOn(store, "getVilla").mockResolvedValue({ ...villa, archivedAt: null });
    const spy = vi
      .spyOn(store, "appendMessages")
      .mockResolvedValue([{ ...message, id: 12, content: "Frage" }, message]);
    const rows = await caller.villa.appendMessages({
      villaId: 3,
      messages: [
        { role: "user", content: "Frage" },
        { role: "assistant", content: "Zusammenfassung", provider: "openrouter/free", model: "m" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith(3, 17, [
      { role: "user", content: "Frage" },
      { role: "assistant", content: "Zusammenfassung", provider: "openrouter/free", model: "m" },
    ]);
    spy.mockResolvedValue([]);
    vi.spyOn(store, "getVilla").mockResolvedValue(undefined);
    await expect(
      caller.villa.appendMessages({ villaId: 99, messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects oversized or empty message batches and bad ratings", async () => {
    await expect(
      caller.villa.appendMessages({ villaId: 3, messages: [] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.villa.appendMessages({
        villaId: 3,
        messages: Array.from({ length: 5 }, () => ({ role: "user" as const, content: "x" })),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.villa.rateMessage({ messageId: 1, rating: 0 as never })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rates only existing assistant messages and returns the stored rating", async () => {
    const spy = vi.spyOn(store, "rateMessage").mockResolvedValue({ ...message, rating: 1 });
    await expect(caller.villa.rateMessage({ messageId: 11, rating: 1 })).resolves.toEqual({
      rating: 1,
    });
    expect(spy).toHaveBeenCalledWith(11, 17, 1);
    spy.mockResolvedValue(undefined);
    await expect(caller.villa.rateMessage({ messageId: 11, rating: -1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("archives and restores villas with an audit entry (Sprint 014)", async () => {
    const spy = vi.spyOn(store, "setVillaArchived");
    spy.mockResolvedValue({ ...villa, archivedAt: new Date() });
    const archived = await caller.villa.archive({ id: 3, archived: true });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(spy).toHaveBeenCalledWith(3, 17, true);
    spy.mockResolvedValue({ ...villa, archivedAt: null });
    const restored = await caller.villa.archive({ id: 3, archived: false });
    expect(restored.archivedAt).toBeNull();
    expect(spy).toHaveBeenCalledWith(3, 17, false);
    spy.mockResolvedValue(undefined);
    await expect(caller.villa.archive({ id: 99, archived: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects appends to archived villas with FORBIDDEN (Sprint 014)", async () => {
    vi.spyOn(store, "getVilla").mockResolvedValue({ ...villa, archivedAt: new Date() });
    await expect(
      caller.villa.appendMessages({ villaId: 3, messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.spyOn(store, "getVilla").mockResolvedValue({ ...villa, archivedAt: null });
    vi.spyOn(store, "appendMessages").mockResolvedValue([message]);
    await expect(
      caller.villa.appendMessages({ villaId: 3, messages: [{ role: "user", content: "x" }] })
    ).resolves.toHaveLength(1);
  });

  it("rejects messages over the villa capacity and manages limits (Sprint 017)", async () => {
    const villaWithCapacity = { ...villa, capacity: 1, archivedAt: null };
    vi.spyOn(store, "getVilla").mockResolvedValue(villaWithCapacity);
    const appendSpy = vi.spyOn(store, "appendMessages").mockResolvedValue([message]);
    const oversized = [{ role: "user" as const, content: "x".repeat(1001) }];
    await expect(
      caller.villa.appendMessages({ villaId: 3, messages: oversized })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(appendSpy).not.toHaveBeenCalled();
    const fitting = [{ role: "user" as const, content: "x".repeat(1000) }];
    await expect(
      caller.villa.appendMessages({ villaId: 3, messages: fitting })
    ).resolves.toHaveLength(1);

    const limits = { maxVillas: 20 };
    const getLimitsSpy = vi.spyOn(store, "getLimitConfig").mockResolvedValue(limits);
    await expect(caller.villa.limits()).resolves.toEqual(limits);
    expect(getLimitsSpy).toHaveBeenCalledWith(17);

    const setLimitsSpy = vi.spyOn(store, "setLimitConfig").mockResolvedValue({
      id: 1, userId: 17, maxVillas: 30, updatedAt: new Date(),
    } as never);
    const adminCaller = appRouter.createCaller(createContext(1, "admin"));
    await expect(
      adminCaller.villa.setLimits({ userId: 17, maxVillas: 30 })
    ).resolves.toMatchObject({ maxVillas: 30 });
    expect(setLimitsSpy).toHaveBeenCalledWith(17, 30);
    await expect(
      caller.villa.setLimits({ userId: 17, maxVillas: 99 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("blocks limit changes for non-admin callers (Sprint 017)", async () => {
    await expect(caller.villa.setLimits({ userId: 17, maxVillas: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("maps createVilla limit errors to FORBIDDEN (Sprint 017)", async () => {
    const createSpy = vi
      .spyOn(store, "createVilla")
      .mockRejectedValue(new store.VillaLimitError(5));
    await expect(
      caller.villa.create({ name: "Zu viel" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createSpy).toHaveBeenCalled();
  });

  it("exports own villas as portable JSON (Sprint 018)", async () => {
    const data = {
      name: "Villa Alpha",
      specialty: "Code-Analyse",
      icon: "bot" as const,
      projectBrief: null,
      description: null,
      capacity: 8,
      messages: [{ role: "user" as const, content: "Frage", createdAt: new Date() }],
      exportedAt: new Date(),
      version: 1 as const,
    };
    const spy = vi.spyOn(store, "exportVilla").mockResolvedValue(data);
    const result = await caller.villa.export({ villaId: 3 });
    expect(result.name).toBe("Villa Alpha");
    expect(result.messages).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(3, 17);
    spy.mockResolvedValue(undefined);
    const otherCaller = appRouter.createCaller(createContext(42));
    await expect(otherCaller.villa.export({ villaId: 3 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("imports villas with messages and rejects oversized payloads (Sprint 018)", async () => {
    const spy = vi.spyOn(store, "importVilla").mockResolvedValue(villa);
    const created = await caller.villa.import({
      name: "Import",
      messages: [{ role: "user", content: "Vorherige Frage" }],
    });
    expect(created.name).toBe("Villa Alpha");
    expect(spy).toHaveBeenCalledWith(17, expect.objectContaining({
      name: "Import",
      capacity: 8,
      messages: [{ role: "user", content: "Vorherige Frage" }],
    }));
    await expect(
      caller.villa.import({
        name: "Import",
        messages: new Array(201).fill({ role: "user", content: "x" }),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.villa.import({
        name: "Import",
        messages: [{ role: "system", content: "x" } as never],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    spy.mockRejectedValue(new store.VillaLimitError(20));
    await expect(caller.villa.import({ name: "Import" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns per-villa activity counters without content (Sprint 019)", async () => {
    const activity = [
      {
        villaId: 3,
        name: "Villa Alpha",
        archived: false,
        capacity: 8,
        messageCount: 12,
        lastActiveAt: new Date("2026-09-28T10:00:00Z"),
      },
    ];
    const spy = vi.spyOn(store, "villaActivity").mockResolvedValue(activity);
    const result = await caller.villa.activity();
    expect(result[0].messageCount).toBe(12);
    expect(result[0].name).toBe("Villa Alpha");
    expect(spy).toHaveBeenCalledWith(17);
    const otherCaller = appRouter.createCaller(createContext(42));
    await otherCaller.villa.activity();
    expect(spy).toHaveBeenCalledWith(42);
  });

  it("maps database outages to a clear service error", async () => {
    vi.spyOn(store, "listVillas").mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    await expect(caller.villa.list()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("starter villa for an empty account", () => {
  it("creates the default project villa for the calling user", async () => {
    const spy = vi
      .spyOn(store, "ensureStarterVilla")
      .mockResolvedValue({ ...villa, id: 8, name: "Projekt-Villa", specialty: "Projektentwicklung" });
    const result = await caller.villa.ensureStarter();
    expect(result.name).toBe("Projekt-Villa");
    expect(spy).toHaveBeenCalledWith(17);
  });

  it("exposes a starter villa configured for project development", () => {
    expect(store.STARTER_VILLA.specialty).toBe("Projektentwicklung");
    expect(store.STARTER_VILLA.icon).toBe("villa");
    expect(store.STARTER_VILLA.projectBrief).toContain("Softwareprojekt");
  });

  it("maps the villa limit to a clear FORBIDDEN error", async () => {
    vi.spyOn(store, "ensureStarterVilla").mockRejectedValue(
      new store.VillaLimitError(20)
    );
    await expect(caller.villa.ensureStarter()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
