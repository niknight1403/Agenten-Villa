import { describe, expect, it, vi, beforeEach } from "vitest";
import type { User } from "../../drizzle/schema";
import * as db from "../db";

vi.mock("./sdk", () => ({
  sdk: { authenticateRequest: vi.fn() },
}));

import { sdk } from "./sdk";
import { createContext, PRIVATE_OWNER_OPEN_ID } from "./context";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    openId: "google:12345",
    name: "Alt-Nutzer",
    email: "alt@example.com",
    loginMethod: "google",
    role: "user",
    lastSignedIn: new Date(),
    ...overrides,
  } as User;
}

function fakeReqRes() {
  return { req: { headers: {} }, res: {} } as unknown as Parameters<
    typeof createContext
  >[0];
}

describe("createContext: Private App ohne Anmeldung", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("meldet Besucher ohne Sitzung automatisch als Besitzer-Admin an", async () => {
    const owner = fakeUser({ id: 1, openId: PRIVATE_OWNER_OPEN_ID, role: "admin" });
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(
      new Error("Invalid session cookie")
    );
    const upsert = vi
      .spyOn(db, "upsertUser")
      .mockResolvedValue(undefined);
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue(owner);

    const ctx = await createContext(fakeReqRes());

    expect(ctx.user).not.toBeNull();
    expect(ctx.user?.role).toBe("admin");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ openId: PRIVATE_OWNER_OPEN_ID, role: "admin" })
    );
  });

  it("stupft eine bestehende Nicht-Admin-Sitzung auf Admin hoch", async () => {
    const existing = fakeUser({ role: "user" });
    vi.mocked(sdk.authenticateRequest).mockResolvedValue(existing);
    const upsert = vi.spyOn(db, "upsertUser").mockResolvedValue(undefined);

    const ctx = await createContext(fakeReqRes());

    expect(ctx.user?.role).toBe("admin");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ openId: "google:12345", role: "admin" })
    );
  });

  it("laesst Admin-Sitzungen unberuehrt", async () => {
    const admin = fakeUser({ role: "admin" });
    vi.mocked(sdk.authenticateRequest).mockResolvedValue(admin);
    const upsert = vi.spyOn(db, "upsertUser").mockResolvedValue(undefined);

    const ctx = await createContext(fakeReqRes());

    expect(ctx.user?.role).toBe("admin");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("bleibt bei DB-Ausfall ehrlich unauthentisiert (kein Fake-Admin)", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("no session"));
    vi.spyOn(db, "upsertUser").mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));

    const ctx = await createContext(fakeReqRes());

    expect(ctx.user).toBeNull();
  });
});
