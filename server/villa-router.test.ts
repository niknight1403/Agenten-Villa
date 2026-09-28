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

function createContext(userId = 17): TrpcContext {
  const now = new Date();
  return {
    user: { id: userId, openId: "test-open-id", email: "user@example.com", name: "Test User", loginMethod: "test", role: "user", createdAt: now, updatedAt: now, lastSignedIn: now },
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

  it("maps database outages to a clear service error", async () => {
    vi.spyOn(store, "listVillas").mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    await expect(caller.villa.list()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
