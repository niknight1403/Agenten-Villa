import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as store from "./demo-store";
import { containsDemoSubmission } from "./_core/demoRateLimit";

vi.mock("./demo-store", async (importOriginal) => ({ ...await importOriginal<typeof store>() }));

function context(role: "user" | "admin" | null): TrpcContext {
  const now = new Date();
  return {
    user: role ? { id: 1, openId: "test", name: "Test", email: "test@example.org", loginMethod: "test", role, createdAt: now, updatedAt: now, lastSignedIn: now } : null,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("demo request privacy and consent", () => {
  it("recognizes the public mutation even inside a tRPC batch", () => {
    expect(containsDemoSubmission("/agent.status,demo.submit")).toBe(true);
    expect(containsDemoSubmission("/demo.submit%2Cagent.status")).toBe(true);
    expect(containsDemoSubmission("/demo.list")).toBe(false);
    // Regression (PR-Agent): ein fuehrender Slash in spaeteren Batch-Positionen
    // darf den Limiter nicht umgehen.
    expect(containsDemoSubmission("agent.status,/demo.submit")).toBe(true);
    expect(containsDemoSubmission("/agent.status, /demo.submit ,x")).toBe(true);
    expect(containsDemoSubmission("agent.status,/demo.submitx")).toBe(false);
  });
  it("never exposes the lead list or status mutation to anonymous and regular users", async () => {
    const list = vi.spyOn(store, "listDemoRequests").mockResolvedValue([]);
    const update = vi.spyOn(store, "setDemoRequestStatus");
    await expect(appRouter.createCaller(context(null)).demo.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(appRouter.createCaller(context("user")).demo.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appRouter.createCaller(context("user")).demo.setStatus({ id: 1, status: "contacted" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(list).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    await expect(appRouter.createCaller(context("admin")).demo.list()).resolves.toEqual([]);
  });

  it("requires explicit contact consent and stores only valid inquiries", async () => {
    const create = vi.spyOn(store, "createDemoRequest").mockResolvedValue();
    const caller = appRouter.createCaller(context(null));
    const inquiry = { name: "Ada Lovelace", company: "Example GmbH", email: "ADA@EXAMPLE.ORG", projectIdea: "Wir brauchen eine bessere Software für Teamprojekte.", contactConsent: true as const, website: "" };
    await expect(caller.demo.submit({ ...inquiry, contactConsent: false as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.demo.submit({ ...inquiry, website: "spam.test" });
    expect(create).not.toHaveBeenCalled();
    await expect(caller.demo.submit(inquiry)).resolves.toEqual({ accepted: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.org", company: "Example GmbH" }));
  });
});
