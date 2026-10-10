import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Villa, VillaRunEvent, VillaTestRun } from "../../drizzle/schema";
import { registerHealthRoute } from "../../server/_core/health";
import { appRouter, type AppRouter } from "../../server/routers";
import { sdk } from "../../server/_core/sdk";
import { createContext } from "../../server/_core/context";
import { TestRunError } from "../../server/test-run-store";
import { VillaLimitError } from "../../server/villa-store";

// Stateful in-memory mock storage for E2E tests
const mockVillas = new Map<number, Villa>();
const mockRuns = new Map<number, VillaTestRun>();
const mockRunEvents: VillaRunEvent[] = [];
let villaIdSeq = 100;
let runIdSeq = 200;

function resetMockDb() {
  mockVillas.clear();
  mockRuns.clear();
  mockRunEvents.length = 0;
  villaIdSeq = 100;
  runIdSeq = 200;
}

vi.mock("../../server/villa-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/villa-store")>();
  return {
    ...actual,
    createVilla: vi.fn(async (data: {
      createdBy: number;
      name: string;
      specialty?: string;
      icon?: "villa" | "bot";
      projectBrief?: string;
      description?: string;
      capacity?: number;
      repository?: string | null;
    }) => {
      if (mockVillas.size >= 20) {
        throw new VillaLimitError(20);
      }
      const id = ++villaIdSeq;
      const now = new Date();
      const villa: Villa = {
        id,
        createdBy: data.createdBy,
        name: data.name,
        specialty: data.specialty ?? "Neuer Agent",
        icon: data.icon ?? "bot",
        projectBrief: data.projectBrief ?? null,
        description: data.description ?? null,
        capacity: data.capacity ?? 8,
        repository: data.repository ?? null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      mockVillas.set(id, villa);
      return villa;
    }),

    listVillas: vi.fn(async (userId: number) => {
      return Array.from(mockVillas.values()).filter(
        (v) => v.createdBy === userId
      );
    }),

    getVilla: vi.fn(async (id: number, userId: number) => {
      const villa = mockVillas.get(id);
      if (!villa || villa.createdBy !== userId) return undefined;
      return villa;
    }),

    deleteVilla: vi.fn(async (id: number, userId: number) => {
      const villa = mockVillas.get(id);
      if (!villa || villa.createdBy !== userId) return false;
      mockVillas.delete(id);
      return true;
    }),

    getLimitConfig: vi.fn(async () => {
      return { maxVillas: 20 };
    }),

    listVillaEvents: vi.fn(async () => {
      return [];
    }),
  };
});

vi.mock("../../server/test-run-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/test-run-store")>();
  return {
    ...actual,
    startTestRun: vi.fn(
      async (
        villaId: number,
        userId: number,
        timeLimitSeconds?: number,
        resumeOfRunId?: number
      ) => {
        const villa = mockVillas.get(villaId);
        if (!villa || villa.createdBy !== userId) {
          throw new TestRunError("NOT_FOUND");
        }
        if (villa.archivedAt) {
          throw new TestRunError("ARCHIVED");
        }

        // Idempotency: return active running run if already present
        const active = Array.from(mockRuns.values()).find(
          (r) => r.villaId === villaId && r.status === "running"
        );
        if (active) return active;

        const id = ++runIdSeq;
        const now = new Date();
        const run: VillaTestRun = {
          id,
          villaId,
          actorId: userId,
          status: "running",
          phase: "preparation",
          timeLimitSeconds: timeLimitSeconds ?? 600,
          result: null,
          errorCode: null,
          cancellationKind: null,
          resumedFromRunId: resumeOfRunId ?? null,
          releasedForResumeAt: null,
          startedAt: now,
          endedAt: null,
          createdAt: now,
        };
        mockRuns.set(id, run);
        return run;
      }
    ),

    finishTestRun: vi.fn(
      async (input: {
        runId: number;
        userId: number;
        status: "succeeded" | "failed" | "cancelled";
        result?: unknown;
        errorCode?: string | null;
      }) => {
        const run = mockRuns.get(input.runId);
        if (!run || run.actorId !== input.userId) {
          throw new TestRunError("NOT_FOUND");
        }
        if (run.status !== "running") {
          if (run.status === input.status) return run;
          throw new TestRunError("STATUS_MISMATCH");
        }
        run.status = input.status;
        run.phase = "result";
        run.endedAt = new Date();
        run.result = input.result ?? null;
        run.errorCode = input.errorCode ?? null;
        mockRuns.set(run.id, run);
        return run;
      }
    ),

    getTestRun: vi.fn(async (runId: number, userId: number) => {
      const run = mockRuns.get(runId);
      if (!run || run.actorId !== userId) return undefined;
      return run;
    }),

    listTestRuns: vi.fn(
      async (userId: number, villaId?: number, limit = 50) => {
        let list = Array.from(mockRuns.values()).filter(
          (r) => r.actorId === userId
        );
        if (villaId !== undefined) {
          list = list.filter((r) => r.villaId === villaId);
        }
        list.sort((a, b) => b.id - a.id);
        return list.slice(0, limit);
      }
    ),

    listRunEvents: vi.fn(
      async (runId: number, userId: number, limit = 50) => {
        const run = mockRuns.get(runId);
        if (!run || run.actorId !== userId) return [];
        return mockRunEvents
          .filter((e) => e.runId === runId)
          .slice(-limit);
      }
    ),

    appendRunEvent: vi.fn(
      async (input: {
        runId: number;
        userId: number;
        level: "info" | "warn" | "error";
        message: string;
      }) => {
        const run = mockRuns.get(input.runId);
        if (!run || run.actorId !== input.userId) {
          throw new TestRunError("NOT_FOUND");
        }
        const event: VillaRunEvent = {
          id: mockRunEvents.length + 1,
          runId: input.runId,
          level: input.level,
          message: input.message,
          createdAt: new Date(),
        };
        mockRunEvents.push(event);
        return event;
      }
    ),

    buildRunReport: vi.fn(
      (run: VillaTestRun, events: VillaRunEvent[], now = new Date()) => {
        const limit = run.timeLimitSeconds ?? 600;
        const endTime = run.status === "running" ? now : (run.endedAt ?? now);
        const durationSeconds = Math.max(
          0,
          Math.floor((endTime.getTime() - run.startedAt.getTime()) / 1000)
        );
        const levels = { info: 0, warn: 0, error: 0 };
        for (const e of events) {
          if (e.level in levels) levels[e.level]++;
        }
        return {
          runId: run.id,
          villaId: run.villaId,
          status: run.status,
          phase: run.phase,
          cancellationKind: run.cancellationKind ?? null,
          errorCode: run.errorCode ?? null,
          resumedFromRunId: run.resumedFromRunId ?? null,
          startedAt: run.startedAt,
          endedAt: run.status === "running" ? null : run.endedAt,
          durationSeconds,
          timeLimitSeconds: limit,
          expired: durationSeconds > limit,
          events: {
            inspected: events.length,
            info: levels.info,
            warn: levels.warn,
            error: levels.error,
            lastMessages: events.map((e) => e.message).reverse().slice(0, 5),
          },
        };
      }
    ),
  };
});

describe("End-to-End Smoke Test Suite (Sprint 085)", () => {
  let server: Server;
  let baseUrl: string;
  let trpcClient: ReturnType<typeof createTRPCClient<AppRouter>>;

  beforeAll(async () => {
    resetMockDb();

    // Sprint 084 — echte Login-Abdeckung: Session-Token-Validierung wie im
    // echten SDK — fehlender Token ist anonym (null), ungueltiger Token
    // wirft, gueltiger Token loest den Nutzer auf. User 17 ist der
    // Standard-Smoke-Nutzer, User 18 traegt den Login-Vollpfad-Test.
    const sessions = new Map<
      string,
      { id: number; openId: string; email: string; name: string }
    >();
    sessions.set("e2e-session-user17", {
      id: 17,
      openId: "e2e-user-openid",
      email: "e2e@example.com",
      name: "E2E Smoke User",
    });
    sessions.set("e2e-session-user18", {
      id: 18,
      openId: "e2e-user18-openid",
      email: "login-flow@example.com",
      name: "Login Flow User",
    });
    vi.spyOn(sdk, "authenticateRequest").mockImplementation(async (req) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) return null;
      const token = authHeader.slice("Bearer ".length);
      const session = sessions.get(token);
      if (!session) throw new Error("INVALID_SESSION");
      const now = new Date();
      return {
        id: session.id,
        openId: session.openId,
        email: session.email,
        name: session.name,
        loginMethod: "test",
        role: "user",
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now,
      };
    });

    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ limit: "50mb", extended: true }));

    // Register REST endpoints
    registerHealthRoute(app);

    // Register tRPC middleware
    app.use(
      "/api/trpc",
      createExpressMiddleware({
        router: appRouter,
        createContext,
      })
    );

    // Boot local server on dynamic free port
    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    trpcClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${baseUrl}/api/trpc`,
          transformer: superjson,
          headers: () => ({ Authorization: "Bearer e2e-session-user17" }),
        }),
      ],
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it("1. Health endpoint (/api/health) answers HTTP 200 with valid payload structure", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBeTypeOf("string");
    expect(body.mode).toBeTypeOf("string");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(body.timestamp).toBeTypeOf("string");
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it("2. Health endpoint exposes public routing status without requiring authentication", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routing).toBeDefined();
    expect(body.routing).toHaveProperty("pinned");
    expect(body.routing).toHaveProperty("pinnedBy");
    expect(body.routing).toHaveProperty("activeRoute");
  });

  it("3. Villa creation (villa.create) creates a valid villa with defaults over HTTP tRPC", async () => {
    const created = await trpcClient.villa.create.mutate({
      name: "   Smoke Villa Alpha   ",
      specialty: "Smoke Test Agent",
      capacity: 10,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe("Smoke Villa Alpha");
    expect(created.specialty).toBe("Smoke Test Agent");
    expect(created.capacity).toBe(10);
    expect(created.createdBy).toBe(17);

    const list = await trpcClient.villa.list.query();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  it("4. Villa creation (villa.create) validates name and rejects empty strings", async () => {
    await expect(
      trpcClient.villa.create.mutate({
        name: "   ",
      })
    ).rejects.toThrow();
  });

  it("5. Villa creation (villa.create) validates capacity limits (1 to 25)", async () => {
    await expect(
      trpcClient.villa.create.mutate({
        name: "Zu gross",
        capacity: 30,
      })
    ).rejects.toThrow();

    await expect(
      trpcClient.villa.create.mutate({
        name: "Zu klein",
        capacity: 0,
      })
    ).rejects.toThrow();
  });

  it("6. Starting a test run (run.start) creates a running test run for an owned villa", async () => {
    const villas = await trpcClient.villa.list.query();
    const villaId = villas[0].id;

    const run = await trpcClient.run.start.mutate({ villaId });
    expect(run.id).toBeGreaterThan(0);
    expect(run.villaId).toBe(villaId);
    expect(run.status).toBe("running");
    expect(run.phase).toBe("preparation");
    expect(run.endedAt).toBeNull();
  });

  it("7. Starting a test run (run.start) is idempotent when a run is already active", async () => {
    const villas = await trpcClient.villa.list.query();
    const villaId = villas[0].id;

    const run1 = await trpcClient.run.start.mutate({ villaId });
    const run2 = await trpcClient.run.start.mutate({ villaId });

    expect(run2.id).toBe(run1.id);
    expect(run2.status).toBe("running");
  });

  it("8. Stopping a test run (run.finish) transitions run to succeeded state", async () => {
    const runs = await trpcClient.run.list.query();
    const activeRun = runs.find((r) => r.status === "running");
    expect(activeRun).toBeDefined();

    const finished = await trpcClient.run.finish.mutate({
      runId: activeRun!.id,
      status: "succeeded",
      result: { smokeChecksPassed: 8 },
    });

    expect(finished.id).toBe(activeRun!.id);
    expect(finished.status).toBe("succeeded");
    expect(finished.endedAt).not.toBeNull();
  });

  it("9. Retrieving a run report (run.report) returns complete summary and events", async () => {
    const runs = await trpcClient.run.list.query();
    const finishedRun = runs[0];

    const report = await trpcClient.run.report.query({
      runId: finishedRun.id,
    });

    expect(report.runId).toBe(finishedRun.id);
    expect(report.status).toBe("succeeded");
    expect(report.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(report.events).toBeDefined();
    expect(report.events.inspected).toBeGreaterThanOrEqual(0);
  });

  it("10. User isolation: villa.list and run.list only return records of the authenticated user", async () => {
    const villas = await trpcClient.villa.list.query();
    expect(villas.length).toBeGreaterThan(0);
    expect(villas.every((v) => v.createdBy === 17)).toBe(true);

    const runs = await trpcClient.run.list.query();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.actorId === 17)).toBe(true);
  });

  it("11. Login: ohne Session-Token ist man anonym — geschützte Prozeduren antworten UNAUTHORIZED (Sprint 084)", async () => {
    const anonymousClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${baseUrl}/api/trpc`,
          transformer: superjson,
          headers: () => ({}),
        }),
      ],
    });

    // Public Prozedur bleibt offen und meldet anonym.
    const me = await anonymousClient.auth.me.query();
    expect(me).toBeNull();

    // Geschützte Prozedur lehnt anonym sauber ab.
    const rejection = await anonymousClient.villa.list
      .query()
      .then(() => undefined, (error: { data?: { code?: string } }) => error);
    expect(rejection?.data?.code).toBe("UNAUTHORIZED");
  });

  it("12. Login: ungültige Session wird als anonym behandelt — nie als Fehler-500 (Sprint 084)", async () => {
    const invalidClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${baseUrl}/api/trpc`,
          transformer: superjson,
          headers: () => ({ Authorization: "Bearer abgelaufen-oder-gefaelscht" }),
        }),
      ],
    });

    const me = await invalidClient.auth.me.query();
    expect(me).toBeNull();

    const rejection = await invalidClient.run.list
      .query()
      .then(() => undefined, (error: { data?: { code?: string } }) => error);
    expect(rejection?.data?.code).toBe("UNAUTHORIZED");
  });

  it("13. Login-Vollpfad: Login, Villa, Lauf und Bericht mit eigener Session durchlaufen (Sprint 084)", async () => {
    // Eigene Session fuer User 18 — alle Schritte laufen als ein
    // durchgehender, login-geschuetzter Pfad.
    const loginClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${baseUrl}/api/trpc`,
          transformer: superjson,
          headers: () => ({ Authorization: "Bearer e2e-session-user18" }),
        }),
      ],
    });

    // Login: Session loest den Nutzer auf.
    const me = await loginClient.auth.me.query();
    expect(me?.id).toBe(18);
    expect(me?.email).toBe("login-flow@example.com");

    // Villa: erstellen und wiederfinden.
    const villa = await loginClient.villa.create.mutate({
      name: "Login-Flow-Villa",
      capacity: 5,
    });
    expect(villa.id).toBeGreaterThan(0);
    const villas = await loginClient.villa.list.query();
    expect(villas.some((v) => v.id === villa.id)).toBe(true);
    expect(villas.every((v) => v.createdBy === 18)).toBe(true);

    // Lauf: starten, stoppen.
    const run = await loginClient.run.start.mutate({ villaId: villa.id });
    expect(run.status).toBe("running");
    const finished = await loginClient.run.finish.mutate({
      runId: run.id,
      status: "succeeded",
      result: { loginFlow: true },
    });
    expect(finished.status).toBe("succeeded");

    // Bericht: vollstaendig abrufbar.
    const report = await loginClient.run.report.query({ runId: run.id });
    expect(report.runId).toBe(run.id);
    expect(report.status).toBe("succeeded");
  });
});
