// server/controller.ts
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";
import { countInterruptedMissions, interruptExpiredRuns } from "./elite-mission-store";
import { checkDatabaseHealth, type DatabaseHealthReport } from "./db-health";
import { checkProviderHealth, type ProviderHealthResult } from "./provider-health";
import { agentMetricsSummary, type AgentMetricsSummary } from "./agent-metrics";
import { turnUsageSummary, type TurnUsageSummary } from "./turn-usage";
import { isProviderActive, type ProviderName } from "./provider-registry";

export type ControllerStatus = "RUNNING" | "STOPPED" | "STARTING" | "STOPPING";

/** Ergebnis eines einzelnen Watchdog-Segments. */
export type WatchdogSegment = "ok" | "error" | "skipped";

/**
 * Ergebnis eines echten 24/7-Worker-Ticks. Alle Segmente sind ungefährlich
 * und begrenzt: Lease-Sweep, DB-Sonde (SELECT 1), Provider-Status-Endpunkte
 * (kein Completion-Aufruf, kein Kontingentverbrauch) und Prozessmetriken.
 * Unterbrochene Missionen werden NUR gezählt und angezeigt — ein Neustart
 * bleibt an die ausdrückliche Administrator-Freigabe gebunden.
 */
export interface WorkerTickReport {
  at: string;
  tick: number;
  leaseSweep: WatchdogSegment;
  database: DatabaseHealthReport | null;
  providers: Array<{ name: ProviderName; status: ProviderHealthResult["status"]; cached: boolean }>;
  interruptedMissions: number | null;
  metrics: AgentMetricsSummary | null;
  /** Sprint 077 — Live-Token-/Budget-Aggregat fuer das Widget. */
  usage: TurnUsageSummary | null;
}

export interface ControllerState {
  status: ControllerStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  activeWorkers: number;
  savedAt: string | null;
  /** Sprint — 24/7-Watchdog: sichtbare, echte Loop-Aktivität. */
  tickCount: number;
  lastTickAt: string | null;
  lastReport: WorkerTickReport | null;
}

const DEFAULT_STATE_FILE = path.resolve(process.cwd(), "data/controller-state.json");

const DEFAULT_STATE: ControllerState = {
  status: "STOPPED",
  startedAt: null,
  stoppedAt: null,
  activeWorkers: 0,
  savedAt: null,
  tickCount: 0,
  lastTickAt: null,
  lastReport: null,
};

/** Standard-Takt: eine Runde pro Minute. */
export const DEFAULT_WATCHDOG_TICK_MS = 60_000;
/** Untergrenze: kein unbegrenzter Loop-Takt. */
export const MIN_WATCHDOG_TICK_MS = 30_000;
/** Provider-Sonden laufen nur jeden n-ten Tick (Standard: alle 5 Minuten). */
export const DEFAULT_PROVIDER_EVERY_N_TICKS = 5;

function watchdogTickMs(): number {
  const raw = Number(process.env.WATCHDOG_TICK_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WATCHDOG_TICK_MS;
  return Math.max(MIN_WATCHDOG_TICK_MS, Math.min(raw, 3_600_000));
}

/** Injection-Punkt für Tests: Abhängigkeiten ohne echte Timer/Dateisystem. */
export interface VillaControllerDeps {
  stateFile?: string;
  tickMs?: number;
  providerEveryNTicks?: number;
  now?: () => Date;
  tickWork?: (tick: number) => Promise<Omit<WorkerTickReport, "at" | "tick">>;
  /** Persistenz-Punkt für Tests (Standard: Dateisystem). */
  persist?: (state: ControllerState) => Promise<void>;
}

export function createVillaController(deps: VillaControllerDeps = {}) {
  const stateFile = deps.stateFile ?? DEFAULT_STATE_FILE;
  const tickMs = deps.tickMs ?? watchdogTickMs();
  const providerEveryNTicks = deps.providerEveryNTicks ?? DEFAULT_PROVIDER_EVERY_N_TICKS;
  const now = deps.now ?? (() => new Date());

  const state: ControllerState = { ...DEFAULT_STATE };
  let workerHandles: NodeJS.Timeout[] = [];
  let ticking = false;

  async function loadState(): Promise<ControllerState> {
    try {
      const raw = await fs.readFile(stateFile, "utf-8");
      const parsed = JSON.parse(raw) as Partial<ControllerState>;
      return { ...DEFAULT_STATE, ...parsed };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async function saveState(): Promise<void> {
    state.savedAt = now().toISOString();
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf-8");
  }

  const persistState: (next: ControllerState) => Promise<void> =
    deps.persist ??
    (async () => {
      await saveState();
    });

  /**
   * Ein echter Worker-Tick: jedes Segment ist einzeln isoliert. Ein Fehler
   * in einem Segment (z. B. Datenbank weg) stoppt weder den Loop noch die
   * anderen Segmente; das Ergebnis wird immer persisted und per SSE
   * veröffentlicht.
   */
  async function defaultTickWork(tick: number): Promise<Omit<WorkerTickReport, "at" | "tick">> {
    // 1) Lease-Sweep: abgelaufene Mission-Leases freigeben (idempotent).
    let leaseSweep: WatchdogSegment = "ok";
    try {
      await interruptExpiredRuns();
    } catch {
      leaseSweep = "error";
    }

    // 2) Datenbank-Sonde: eine harmlose SELECT-1-Anfrage.
    let database: DatabaseHealthReport | null = null;
    try {
      database = await checkDatabaseHealth();
    } catch {
      database = null;
    }

    // 3) Provider-Sonden: nur reine Status-Endpunkte, begrenzt und gecacht
    //    (siehe provider-health.ts); konfigurierbar seltener als der Takt.
    const providers: WorkerTickReport["providers"] = [];
    if (tick % providerEveryNTicks === 0) {
      for (const name of ["openrouter", "groq", "gemini", "huggingface"] as ProviderName[]) {
        if (!isProviderActive(name)) continue;
        try {
          const result = await checkProviderHealth(name);
          providers.push({ name, status: result.status, cached: result.cached });
        } catch {
          providers.push({ name, status: "unavailable", cached: false });
        }
      }
    }

    // 4) Unterbrochene Missionen: reine Anzeige (HITL — kein Auto-Neustart).
    let interruptedMissions: number | null = null;
    try {
      interruptedMissions = await countInterruptedMissions();
    } catch {
      interruptedMissions = null;
    }

    // 5) Prozessmetriken der Elite-Läufe.
    let metrics: AgentMetricsSummary | null = null;
    try {
      metrics = agentMetricsSummary();
    } catch {
      metrics = null;
    }

    // 6) Sprint 077 — Live-Token-/Budget-Aggregat (begrenzte Historie).
    let usage: TurnUsageSummary | null = null;
    try {
      usage = turnUsageSummary();
    } catch {
      usage = null;
    }

    return { leaseSweep, database, providers, interruptedMissions, metrics, usage };
  }

  const tickWork = deps.tickWork ?? defaultTickWork;

  async function runTick(): Promise<WorkerTickReport> {
    const tick = state.tickCount + 1;
    const report: WorkerTickReport = {
      ...(await tickWork(tick)),
      at: now().toISOString(),
      tick,
    };
    state.tickCount = tick;
    state.lastTickAt = report.at;
    state.lastReport = report;
    await persistState(state);
    return report;
  }

  async function init(): Promise<void> {
    const persisted = await loadState();
    Object.assign(state, persisted);
    // 24/7-Semantik: ein Lauf im Zustand RUNNING/STARTING wird nach einem
    // Prozessneustart fortgesetzt statt still in STOPPED zu enden.
    if (state.status === "RUNNING" || state.status === "STARTING") {
      state.status = "RUNNING";
      bootWorkers();
      await persistState(state);
    }
    console.log(`[Controller] Initialisiert — Status: ${state.status}`);
  }

  function bootWorkers(): void {
    const handle = setInterval(() => {
      if (ticking) return; // nie überlappende Ticks
      ticking = true;
      void runTick()
        .then(report => controller.emit("tick", report))
        .catch(() => {
          // Ein fehlgeschlagener Tick killt den Loop nie; der nächste
          // geplante Tick läuft planmäßig wieder.
        })
        .finally(() => {
          ticking = false;
        });
    }, tickMs);
    handle.unref?.();
    workerHandles.push(handle);
    state.activeWorkers = workerHandles.length;
  }

  const controller = Object.assign(new EventEmitter(), {
    getState(): ControllerState {
      return { ...state, lastReport: state.lastReport ? { ...state.lastReport } : null };
    },

    async init() {
      return init();
    },

    async start(): Promise<ControllerState> {
      if (state.status === "RUNNING") return controller.getState();
      state.status = "STARTING";
      controller.emit("statusChange", controller.getState());
      bootWorkers();
      state.status = "RUNNING";
      state.startedAt = now().toISOString();
      state.stoppedAt = null;
      await persistState(state);
      controller.emit("statusChange", controller.getState());
      return controller.getState();
    },

    async stop(): Promise<ControllerState> {
      if (state.status === "STOPPED") return controller.getState();
      state.status = "STOPPING";
      controller.emit("statusChange", controller.getState());
      workerHandles.forEach(clearInterval);
      workerHandles = [];
      state.activeWorkers = 0;
      state.status = "STOPPED";
      state.stoppedAt = now().toISOString();
      await persistState(state);
      controller.emit("statusChange", controller.getState());
      return controller.getState();
    },

    /** Einmaliger manueller Tick (z. B. Diagnose) — gleiche Isolation. */
    async tickOnce(): Promise<WorkerTickReport> {
      const report = await runTick();
      controller.emit("tick", report);
      return report;
    },

    _resetForTests(): void {
      workerHandles.forEach(clearInterval);
      workerHandles = [];
      ticking = false;
      Object.assign(state, DEFAULT_STATE);
    },
  });

  return controller;
}

export type VillaController = ReturnType<typeof createVillaController>;

/** Prozessweiter Singleton — der echte 24/7-Watchdog der Villa. */
export const villaController = createVillaController();

/**
 * Sprint 029 — Controller-Berechtigungen: globale Steuerungen des Villasystems
 * (start/stop/toggle) dürfen nur Administratoren verwenden. Die Rolle kommt
 * ausschließlich aus der verifizierten Authentifizierung, nie aus einer
 * selbst deklarierten Angabe.
 */
function requireAdmin(user: { role: string }) {
  if (user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Nur Administratoren dürfen globale Steuerungen verwenden.",
    });
  }
}

export const controllerRouter = router({
  /** Status ist lesbar für alle angemeldeten Nutzer — Steuerung ist Admin-only. */
  getStatus: protectedProcedure.query(() => villaController.getState()),
  /** Einmaliger Watchdog-Tick für die Diagnose — Admin-only, begrenzt. */
  tickNow: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user);
    return villaController.tickOnce();
  }),
  start: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user);
    return villaController.start();
  }),
  stop: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user);
    return villaController.stop();
  }),
  toggle: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user);
    const { status } = villaController.getState();
    if (status === "RUNNING") return villaController.stop();
    return villaController.start();
  }),
});
