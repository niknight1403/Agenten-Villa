import type { RequestHandler } from "express";
import { rateLimit } from "./rate-limit";

const submitLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, keyPrefix: "demo-submit" });

/** tRPC batches multiple procedures into a comma-separated path. */
export function containsDemoSubmission(rawPath: string): boolean {
  try {
    // Normalize each batched procedure individually: a leading slash on any
    // position (e.g. "agent.status,/demo.submit") must not bypass the limiter.
    // Query strings (e.g. "/demo.submit?batch=1") must not hide the procedure.
    const decodedPath = decodeURIComponent(rawPath).split("?")[0];
    return decodedPath
      .split(",")
      .some(part => part.trim().replace(/^\/+|\/+$/g, "") === "demo.submit");
  } catch {
    // Malformed encoding must not create a route around the limiter.
    return true;
  }
}

export const demoSubmitRateLimit: RequestHandler = (req, res, next) => {
  if (containsDemoSubmission(req.path)) return submitLimit(req, res, next);
  next();
};
