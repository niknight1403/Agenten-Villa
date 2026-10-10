import type { ErrorRequestHandler, RequestHandler } from "express";
import { startCorrelation, structuredLog } from "../structured-log";

/**
 * Sprint 078 — Strukturierter HTTP-Zugriffs-Logger: eine JSON-Zeile pro
 * Request mit Korrelations-ID, Status und Dauer. Health-Checks bleiben
 * still, damit die Render-Logs nicht mit Prüfzyklen volllaufen.
 * Die Korrelations-ID wird als `X-Request-Id`-Antwortkopf zurückgegeben
 * (wenn vom Response-Objekt unterstützt), damit Nutzer-Supportmeldungen
 * eindeutig einer Logzeile zugeordnet werden können.
 */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const { correlationId, elapsedMs } = startCorrelation();
    if (typeof res.setHeader === "function")
      res.setHeader("X-Request-Id", correlationId);
    res.on("finish", () => {
      const pathname = (req.originalUrl ?? req.url ?? "").split("?")[0];
      if (pathname === "/api/health") return;
      structuredLog("info", "http_request", {
        correlationId,
        method: req.method,
        path: pathname,
        status: res.statusCode,
        durationMs: elapsedMs(),
      });
    });
    next();
  };
}

/**
 * Letzter Fallback für unbehandelte Fehler: loggt strukturiert serverseitig
 * (Stack nur in die Logzeile, ohne Interna nach außen) und antwortet mit
 * einem JSON-500 inklusive Korrelations-ID.
 */
export function jsonErrorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) return;
    const { correlationId, elapsedMs } = startCorrelation();
    structuredLog("error", "unhandled_request_error", {
      correlationId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? "") : "",
      durationMs: elapsedMs(),
    });
    if (typeof res.setHeader === "function")
      res.setHeader("X-Request-Id", correlationId);
    res.status(500).json({
      error: "Interner Serverfehler.",
      requestId: correlationId,
    });
  };
}
