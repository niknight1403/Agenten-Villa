// server/controller.ts
import { z } from "zod";
import { initTRPC } from "@trpc/server";
import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";

export type ControllerStatus = "RUNNING" | "STOPPED" | "STARTING" | "STOPPING";

export interface ControllerState {
  status: ControllerStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  activeWorkers: number;
  savedAt: string | null;
}

const STATE_FILE = path.resolve(process.cwd(), "data/controller-state.json");

const DEFAULT_STATE: ControllerState = {
  status: "STOPPED",
  startedAt: null,
  stoppedAt: null,
  activeWorkers: 0,
  savedAt: null,
};

async function loadState(): Promise<ControllerState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state: ControllerState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(
    STATE_FILE,
    JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

class VillaController extends EventEmitter {
  private state: ControllerState = { ...DEFAULT_STATE };
  private workerHandles: NodeJS.Timeout[] = [];

  async init() {
    this.state = await loadState();
    if (this.state.status === "RUNNING" || this.state.status === "STARTING") {
      this.state.status = "STOPPED";
      this.state.activeWorkers = 0;
      await saveState(this.state);
    }
    console.log(`[Controller] Initialisiert — Status: ${this.state.status}`);
  }

  getState(): ControllerState {
    return { ...this.state };
  }

  async start(): Promise<ControllerState> {
    if (this.state.status === "RUNNING") return this.getState();
    this.state.status = "STARTING";
    this.emit("statusChange", this.state);
    await this.bootWorkers();
    this.state.status = "RUNNING";
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    await saveState(this.state);
    this.emit("statusChange", this.state);
    return this.getState();
  }

  async stop(): Promise<ControllerState> {
    if (this.state.status === "STOPPED") return this.getState();
    this.state.status = "STOPPING";
    this.emit("statusChange", this.state);
    this.workerHandles.forEach(clearInterval);
    this.workerHandles = [];
    this.state.activeWorkers = 0;
    this.state.status = "STOPPED";
    this.state.stoppedAt = new Date().toISOString();
    await saveState(this.state);
    this.emit("statusChange", this.state);
    return this.getState();
  }

  private async bootWorkers(): Promise<void> {
    const tick = setInterval(() => {
      console.log(`[Worker-Tick] ${new Date().toISOString()}`);
    }, 30_000);
    this.workerHandles.push(tick);
    this.state.activeWorkers = this.workerHandles.length;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export const villaController = new VillaController();

const t = initTRPC.create();

export const controllerRouter = t.router({
  getStatus: t.procedure.query(() => villaController.getState()),
  start: t.procedure.mutation(async () => villaController.start()),
  stop: t.procedure.mutation(async () => villaController.stop()),
  toggle: t.procedure.mutation(async () => {
    const { status } = villaController.getState();
    if (status === "RUNNING") return villaController.stop();
    return villaController.start();
  }),
});
