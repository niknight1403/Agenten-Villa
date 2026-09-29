import type { RequestHandler } from "express";
import { rateLimit } from "./rate-limit";

const submitLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, keyPrefix: "demo-submit" });

/** tRPC batches multiple procedures into a comma-separated path. */
export function containsDemoSubmission(rawPath: string): boolean {
  try {
    return decodeURIComponent(rawPath).replace(/^\/+/, "").split(",").includes("demo.submit");
  } catch {
    // Malformed encoding must not create a route around the limiter.
    return true;
  }
}

export const demoSubmitRateLimit: RequestHandler = (req, res, next) => {
  if (containsDemoSubmission(req.path)) return submitLimit(req, res, next);
  next();
};
