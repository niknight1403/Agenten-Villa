import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

/**
 * Private App: Die Anmeldung ist abgeschaltet. Jeder Aufruf ohne gueltige
 * Sitzung wird automatisch als Besitzer-Administrator angemeldet, und eine
 * bestehende (z. B. Google-)Sitzung wird auf die Admin-Rolle hochgestuft,
 * damit der Besitzer in jedem Fall vollen administrativen Zugriff hat.
 */
export const PRIVATE_OWNER_OPEN_ID = "local:owner";

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  if (!user) {
    try {
      await db.upsertUser({
        openId: PRIVATE_OWNER_OPEN_ID,
        name: "Hallo",
        role: "admin",
      });
      user = (await db.getUserByOpenId(PRIVATE_OWNER_OPEN_ID)) ?? null;
    } catch (error) {
      console.error("[Auth] Auto-Login fehlgeschlagen:", error);
      user = null;
    }
  } else if (user.role !== "admin") {
    try {
      await db.upsertUser({ openId: user.openId, role: "admin" });
      user = { ...user, role: "admin" };
    } catch (error) {
      console.error("[Auth] Admin-Hochstufung fehlgeschlagen:", error);
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
