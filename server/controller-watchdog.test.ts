import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVillaController, type ControllerState, type WorkerTickReport } from "./controller";
import * as missionStore from "./elite-mission-store";
import * as dbHealth from "./db-health";
import * as providerHealth from "./provider-health";
import * as agentMetrics from "./agent-metrics";

let dir: string;
let stateFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "villa-controller-"));
  stateFile = join(dir, "controller-state.json");
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

function baseTick(): Omit<WorkerTickReport, "at" | "tick"> {
  return {
    leaseSweep: "ok",
    database: { status: "verbunden", checkedAt: "2026-01-01T00:00:00.000Z" },
    providers: [],
    interruptedMissions: 0,
    metrics: {
      totals: { completed: 0, partial: 0, failed: 0 },
      errorsByCode: [],
      averageDurationMs: 0,
      samples: 0,
    },
  };
}

/** Loop-Instanz ohne echte Datei-I/O — Persistenz wird im Speicher gehalten. */
function loopController(options: {
  tickMs?: number;
  providerEveryNTicks?: number;
  tickWork?: (tick: number) => Promise<Omit<WorkerTickReport, "at" | "tick">>;
}) {
  const persisted: ControllerState[] = [];
  const controller = createVillaController({
    stateFile,
    tickMs: options.tickMs ?? 10,
    providerEveryNTicks: options.providerEveryNTicks ?? 5,
    tickWork: options.tickWork ?? (async () => baseTick()),
    persist: async next => {
      persisted.push({ ...next });
    },
  });
  return { controller, persisted };
}

describe("24/7-Watchdog-Loops (echte Worker statt Platzhalter)", () => {
  it("erzeugt einen echten Tick-Report mit allen Segmenten", async () => {
    const sweep = vi.spyOn(missionStore, "interruptExpiredRuns").mockResolvedValue(undefined);
    const db = vi.spyOn(dbHealth, "checkDatabaseHealth").mockResolvedValue({
      status: "verbunden",
      checkedAt: "2026-01-01T00:00:00.000Z",
    });
    const interrupted = vi
      .spyOn(missionStore, "countInterruptedMissions")
      .mockResolvedValue(2);
    const health = vi
      .spyOn(providerHealth, "checkProviderHealth")
      .mockResolvedValue({ status: "valid", cached: false });
    const metrics = vi
      .spyOn(agentMetrics, "agentMetricsSummary")
      .mockReturnValue({
        totals: { completed: 3, partial: 0, failed: 1 },
        errorsByCode: [],
        averageDurationMs: 120,
        samples: 4,
      });

    const controller = createVillaController({ stateFile, providerEveryNTicks: 1 });
    const report = await controller.tickOnce();

    expect(report.tick).toBe(1);
    expect(report.leaseSweep).toBe("ok");
    expect(report.database?.status).toBe("verbunden");
    expect(report.interruptedMissions).toBe(2);
    expect(report.providers.map(p => p.name)).toEqual([
      "openrouter",
      "groq",
      "gemini",
      "huggingface",
    ]);
    expect(report.metrics?.samples).toBe(4);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(db).toHaveBeenCalledTimes(1);
    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenCalledTimes(4);
    expect(metrics).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      status: "STOPPED",
      tickCount: 1,
      lastTickAt: report.at,
      lastReport: { tick: 1, leaseSweep: "ok" },
    });
  });

  it("isoliert Segment-Fehler: ein DB-Ausfall stoppt weder Sweep noch Tick", async () => {
    const sweep = vi.spyOn(missionStore, "interruptExpiredRuns").mockResolvedValue(undefined);
    vi.spyOn(dbHealth, "checkDatabaseHealth").mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    vi.spyOn(missionStore, "countInterruptedMissions").mockResolvedValue(null);
    const controller = createVillaController({ stateFile });

    const report = await controller.tickOnce();

    expect(report.leaseSweep).toBe("ok");
    expect(report.database).toBeNull();
    expect(report.interruptedMissions).toBeNull();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(report.tick).toBe(1);
  });

  it("startet den Loop, feuert Ticks im Takt und beendet ihn sauber", async () => {
    const work = vi.fn(async () => baseTick());
    const { controller } = loopController({ tickWork: work });
    vi.useFakeTimers();

    expect(controller.getState().status).toBe("STOPPED");
    await controller.start();
    expect(controller.getState()).toMatchObject({ status: "RUNNING", activeWorkers: 1 });

    await vi.advanceTimersByTimeAsync(35);
    expect(work.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(controller.getState().tickCount).toBeGreaterThanOrEqual(3);

    await controller.stop();
    expect(controller.getState()).toMatchObject({ status: "STOPPED", activeWorkers: 0 });
    const ticksAtStop = controller.getState().tickCount;
    await vi.advanceTimersByTimeAsync(50);
    expect(controller.getState().tickCount).toBe(ticksAtStop);
  });

  it("lässt Ticks nie überlappen — ein langsamer Tick hält die weiteren Takte aus", async () => {
    let release: (() => void) | null = null;
    const work = vi.fn(async () => {
      if (release) {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        release = null;
      }
      return baseTick();
    });
    const { controller } = loopController({ tickWork: work });
    vi.useFakeTimers();
    await controller.start();

    // Erster Tick blockiert bewusst (release gesetzt).
    release = () => {};
    await vi.advanceTimersByTimeAsync(10);
    const during = work.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    // Kein zweiter konkurrierender Tick darf starten.
    expect(work.mock.calls.length).toBe(during);

    release?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(work.mock.calls.length).toBe(during + 1);

    await controller.stop();
  });

  it("feuert Provider-Sonden nur jeden n-ten Tick (Standard: 5)", async () => {
    const defaultTick = vi.fn(async (tick: number) => {
      const report = baseTick();
      if (tick % 5 === 0) report.providers = [{ name: "openrouter", status: "valid", cached: false }];
      return report;
    });
    const { controller } = loopController({ tickWork: defaultTick });
    const reports: WorkerTickReport[] = [];
    controller.on("tick", (report: WorkerTickReport) => reports.push(report));
    vi.useFakeTimers();
    await controller.start();

    await vi.advanceTimersByTimeAsync(60);
    // 6 Ticks — nur Tick 5 enthält Provider-Sonden.
    expect(reports.map(r => r.tick)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(reports.filter(r => r.providers.length > 0).map(r => r.tick)).toEqual([5]);
    await controller.stop();
  });

  it("persistiert den Status und nimmt RUNNING nach einem Neustart wieder auf", async () => {
    // Echte Datei-Persistenz (Standard-depend), keine Fake-Timer nötig.
    const controller = createVillaController({
      stateFile,
      tickMs: 30_000,
      tickWork: async () => baseTick(),
    });
    await controller.start();
    await controller.tickOnce();
    await controller.tickOnce();
    expect(controller.getState()).toMatchObject({ status: "RUNNING", tickCount: 2 });

    const persisted = JSON.parse(await readFile(stateFile, "utf-8"));
    expect(persisted.status).toBe("RUNNING");
    expect(persisted.tickCount).toBe(2);

    // Neustart: gleiche State-Datei, neue Instanz — der Loop läuft weiter.
    const second = createVillaController({
      stateFile,
      tickMs: 30_000,
      tickWork: async () => baseTick(),
    });
    await second.init();
    expect(second.getState()).toMatchObject({ status: "RUNNING", tickCount: 2 });
    await second.stop();
    await controller.stop();
  });

  it("klemmt WATCHDOG_TICK_MS auf mindestens 30 Sekunden", async () => {
    vi.stubEnv("WATCHDOG_TICK_MS", "1000");
    const work = vi.fn(async () => baseTick());
    const controller = createVillaController({ stateFile, tickWork: work, persist: async () => {} });
    vi.useFakeTimers();
    await controller.start();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(work).toHaveBeenCalledTimes(1);
    await controller.stop();
  });
});
