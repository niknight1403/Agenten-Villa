import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { configuredProviders, PROVIDER_NOTICE, runAgentTurn, safeAgentError } from "./agent-engine";

let controlState: "RUNNING" | "STOPPED" = "STOPPED";
const usage = new Map<number, { start: number; count: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_TURNS_PER_WINDOW = 12;

function isAdmin(user: { role: string; email?: string | null }) {
  const allowlisted = process.env.AGENT_ADMIN_EMAIL?.trim().toLowerCase();
  return user.role === "admin" || Boolean(allowlisted && user.email?.trim().toLowerCase() === allowlisted);
}

function requireAdmin(user: { role: string; email?: string | null }) {
  if (!isAdmin(user)) throw new TRPCError({ code: "FORBIDDEN", message: "Nur der konfigurierte Administrator kann den Agenten steuern." });
}

function consumeTurn(userId: number) {
  const now = Date.now();
  const current = usage.get(userId);
  if (!current || now - current.start >= WINDOW_MS) {
    usage.set(userId, { start: now, count: 1 });
    return;
  }
  if (current.count >= MAX_TURNS_PER_WINDOW) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Das lokale Stundenlimit ist erreicht. Bitte später erneut versuchen." });
  current.count += 1;
}

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4_000) })).max(20),
  mode: z.enum(["home", "workshop"]),
  specialty: z.string().max(80),
  allowHuggingFaceFallback: z.boolean().default(false),
});

export const agentRouter = router({
  status: protectedProcedure.query(({ ctx }) => ({
    state: controlState,
    isAdmin: isAdmin(ctx.user),
    providers: configuredProviders(),
    notice: PROVIDER_NOTICE,
    limits: { turnsPerHour: MAX_TURNS_PER_WINDOW, providerCallsPerTurn: 2 },
  })),
  setState: protectedProcedure.input(z.object({ state: z.enum(["RUNNING", "STOPPED"]) })).mutation(({ ctx, input }) => {
    requireAdmin(ctx.user);
    controlState = input.state;
    return { state: controlState };
  }),
  chat: protectedProcedure.input(inputSchema).mutation(async ({ ctx, input }) => {
    if (controlState !== "RUNNING") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Der Agent steht auf STOPPED. Der Administrator muss ihn ausdrücklich starten." });
    consumeTurn(ctx.user.id);
    try {
      const result = await runAgentTurn(input, input.allowHuggingFaceFallback, {
        beforeFallback: async () => controlState === "RUNNING",
      });
      return { ...result, workflow: ["Planung", "Transformation", "Prüfung", "Verbesserung"], notice: PROVIDER_NOTICE };
    } catch (error) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: safeAgentError(error) });
    }
  }),
});

export const agentControlLimits = { windowMs: WINDOW_MS, maxTurnsPerWindow: MAX_TURNS_PER_WINDOW } as const;
export function resetAgentRouterForTests() { controlState = "STOPPED"; usage.clear(); }
export function getAgentRouterStateForTests() { return controlState; }
export function isAgentAdminForTests(user: { role: string; email?: string | null }) { return isAdmin(user); }
export function consumeTurnForTests(userId: number) { consumeTurn(userId); }
export function setAgentStateForTests(state: "RUNNING" | "STOPPED") { controlState = state; }
