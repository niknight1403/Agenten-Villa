import { Router, Request, Response } from "express";
import { villaController } from "./controller";

export const controllerSseRouter = Router();

/**
 * 24/7-Watchdog-Livestream. Zwei Ereignistypen:
 *  - { type: "state", state }  — Statuswechsel des Controllers
 *  - { type: "tick", report }  — jeder echte Worker-Tick mit Segmentergebnis
 */
controllerSseRouter.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (type: "state" | "tick", payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  send("state", { state: villaController.getState() });

  const onStatusChange = () => send("state", { state: villaController.getState() });
  const onTick = (report: Record<string, unknown>) => send("tick", { report });

  villaController.on("statusChange", onStatusChange);
  villaController.on("tick", onTick);

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
  heartbeat.unref?.();

  req.on("close", () => {
    villaController.off("statusChange", onStatusChange);
    villaController.off("tick", onTick);
    clearInterval(heartbeat);
  });
});
