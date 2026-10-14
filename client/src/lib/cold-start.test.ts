import { describe, expect, it, vi } from "vitest";

import { fetchWithResilience, prewarmServer, shouldRetryFetch } from "@/lib/cold-start";

const okResponse = () => new Response("{}", { status: 200 });

describe("shouldRetryFetch", () => {
  it("behandelt Netzwerkfehler (TypeError) und Timeout als transient", () => {
    expect(shouldRetryFetch(new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryFetch(new DOMException("Timeout", "TimeoutError"))).toBe(true);
    expect(shouldRetryFetch(new DOMException("Aborted", "AbortError"))).toBe(true);
  });

  it("wiederholt fachliche Fehler nicht (4xx fliegt als Response, andere Errors direkt)", () => {
    expect(shouldRetryFetch(new Error("irgendwas"))).toBe(false);
    expect(shouldRetryFetch(null)).toBe(false);
  });
});

describe("fetchWithResilience", () => {
  it("holt nach transienten Fehlern automatisch nach und liefert dann die Antwort", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("cold start")).mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithResilience("https://villa.example/api/trpc", undefined, { retries: 2 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("uebersteht einen 30s+-Cold-Start (Timeout gross genug, ein Retry genuegt)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithResilience("https://villa.example/api/trpc", { credentials: "include" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("wirft nach Erschoepfung der Versuche den letzten Fehler (kein stilles Schlucken)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("dauerhaft down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithResilience("https://villa.example/api", undefined, { retries: 2 })).rejects.toThrow("dauerhaft down");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("uebergibt Credentials und Init treu an fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    await fetchWithResilience("https://villa.example/x", { credentials: "include", headers: { A: "b" } });
    const call = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(call[1].credentials).toBe("include");
    expect(call[1].headers).toEqual({ A: "b" });
    vi.unstubAllGlobals();
  });
});

describe("prewarmServer", () => {
  it("feuert /api/health fire-and-forget ab und wirft niemals", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("egal"));
    vi.stubGlobal("fetch", fetchMock);
    expect(() => prewarmServer("https://villa.example/")).not.toThrow();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://villa.example/api/health");
    vi.unstubAllGlobals();
  });
});
