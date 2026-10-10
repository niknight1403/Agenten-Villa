import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as consentStore from "./telemetry-consent";

vi.mock("./telemetry-consent", () => ({
  TELEMETRY_PRIVACY_NOTICE: "Hinweis aus dem Mock.",
  getTelemetryConsent: vi.fn(),
  setTelemetryConsent: vi.fn(),
}));

function createContext(userId = 17): TrpcContext {
  const now = new Date();
  return {
    user: { id: userId, openId: "test-open-id", email: "user@example.com", name: "Test User", loginMethod: "test", role: "user", createdAt: now, updatedAt: now, lastSignedIn: now },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

let caller: ReturnType<typeof appRouter.createCaller>;

beforeEach(() => {
  vi.mocked(consentStore.getTelemetryConsent).mockReset();
  vi.mocked(consentStore.setTelemetryConsent).mockReset();
  caller = appRouter.createCaller(createContext());
});

describe("telemetry router (Sprint 098)", () => {
  it("liefert Zustand und Datenschutz-Hinweis unveraendert", async () => {
    vi.mocked(consentStore.getTelemetryConsent).mockResolvedValue({
      optedIn: true,
      notice: "Hinweis aus dem Mock.",
    });
    const state = await caller.telemetry.consent();
    expect(state.optedIn).toBe(true);
    expect(state.notice).toBe("Hinweis aus dem Mock.");
    expect(consentStore.getTelemetryConsent).toHaveBeenCalledWith(17);
  });

  it("Standard ist AUS, wenn der Store nicht eingewilligt meldet", async () => {
    vi.mocked(consentStore.getTelemetryConsent).mockResolvedValue({
      optedIn: false,
      notice: "Hinweis aus dem Mock.",
    });
    expect((await caller.telemetry.consent()).optedIn).toBe(false);
  });

  it("setConsent reicht die Entscheidung an den Store weiter", async () => {
    vi.mocked(consentStore.setTelemetryConsent).mockResolvedValue({
      optedIn: false,
      notice: "Hinweis aus dem Mock.",
    });
    await caller.telemetry.setConsent({ optedIn: false });
    expect(consentStore.setTelemetryConsent).toHaveBeenCalledWith(17, false);
  });

  it("uebersetzt einen Speicherfehler in SERVICE_UNAVAILABLE", async () => {
    vi.mocked(consentStore.setTelemetryConsent).mockRejectedValue(
      new Error("DATABASE_UNAVAILABLE")
    );
    await expect(
      caller.telemetry.setConsent({ optedIn: true })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
