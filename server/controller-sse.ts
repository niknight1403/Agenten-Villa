import { Router, Request, Response } from "express";
import { villaController } from "./controller";

export const controllerSseRouter = Router();

controllerSseRouter.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendState = () => {
    res.write(`data: ${JSON.stringify(villaController.getState())}\n\n`);
  };
  sendState();

  const onStatusChange = () => sendState();
  villaController.on("statusChange", onStatusChange);

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);

  req.on("close", () => {
    villaController.off("statusChange", onStatusChange);
    clearInterval(heartbeat);
  });
});
