import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { configuredProviders, PROVIDER_NOTICE, runAgentTurn, safeAgentError, verifyOpenRouterKey } from "./agent-engine";

let controlState: "RUNNING" | "STOPPED" = "STOPPED";
const usage = new Map<number, { start: number; count: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_TURNS_PER_WINDOW = 12;
const CREDENTIAL_CHECK_WINDOW_MS = 15 * 60 * 1000;
const MAX_CREDENTIAL_CHECKS = 5;
const credentialChecks = new Map<number, { start: number; count: number }>();

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

function consumeCredentialCheck(userId: number) {
  const now = Date.now();
  const current = credentialChecks.get(userId);
  if (!current || now - current.start >= CREDENTIAL_CHECK_WINDOW_MS) {
    credentialChecks.set(userId, { start: now, count: 1 });
    return;
  }
  if (current.count >= MAX_CREDENTIAL_CHECKS) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Zu viele Schlüsselprüfungen. Bitte später erneut versuchen." });
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
  testOpenRouterKey: protectedProcedure.input(z.object({ apiKey: z.string().trim().min(8).max(512) })).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    consumeCredentialCheck(ctx.user.id);
    const status = await verifyOpenRouterKey(input.apiKey);
    return {
      status,
      message: status === "valid"
        ? "Authentifizierung erfolgreich. Der Schlüssel wurde nur für diese Prüfung verwendet und nicht gespeichert."
        : status === "invalid"
          ? "OpenRouter hat den Schlüssel abgewiesen. Bitte prüfe ihn und versuche es erneut. Der Schlüssel wurde nicht gespeichert."
          : "OpenRouter ist gerade nicht erreichbar oder begrenzt Prüfungen. Es wurde nichts gespeichert.",
    } as const;
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
export const credentialCheckLimits = { windowMs: CREDENTIAL_CHECK_WINDOW_MS, maxChecks: MAX_CREDENTIAL_CHECKS } as const;
export function resetAgentRouterForTests() { controlState = "STOPPED"; usage.clear(); credentialChecks.clear(); }
export function getAgentRouterStateForTests() { return controlState; }
export function isAgentAdminForTests(user: { role: string; email?: string | null }) { return isAdmin(user); }
export function consumeTurnForTests(userId: number) { consumeTurn(userId); }
export function consumeCredentialCheckForTests(userId: number) { consumeCredentialCheck(userId); }
export function setAgentStateForTests(state: "RUNNING" | "STOPPED") { controlState = state; }
