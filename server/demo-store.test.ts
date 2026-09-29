import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoRequest, setDemoRequestStatus } from "./demo-store";
import { getDb } from "./db";
import { demoContactOptOuts, demoRequests } from "../drizzle/schema";

vi.mock("./db", async importOriginal => ({ ...await importOriginal<typeof import("./db")>(), getDb: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("demo contact suppression", () => {
  it("accepts an opted-out address without creating a new contactable lead", async () => {
    const insert = vi.fn();
    const execute = vi.fn();
    const tx = {
      execute,
      select: vi.fn().mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ email: "ada@example.org" }] }) }) }),
      insert,
    };
    vi.mocked(getDb).mockResolvedValue({ transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx) } as never);
    await expect(createDemoRequest({ name: "Ada", company: "Firma", email: "ADA@EXAMPLE.ORG", projectIdea: "Ein Projekt für bessere Teamarbeit." })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();
  });

  it("persists the normalized opt-out and suppresses existing leads in the same transaction", async () => {
    const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const tx = {
      execute: vi.fn(),
      select: vi.fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ email: "ada@example.org" }] }) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ id: 7, status: "opted_out" }] }) }) }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    };
    vi.mocked(getDb).mockResolvedValue({ transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as never);
    await expect(setDemoRequestStatus(7, "opted_out")).resolves.toMatchObject({ id: 7, status: "opted_out" });
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(tx.insert).toHaveBeenCalledWith(demoContactOptOuts);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.org" }));
    expect(tx.update).toHaveBeenCalledWith(demoRequests);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "opted_out" }));
    expect(updateWhere).toHaveBeenCalledOnce();
  });
});
