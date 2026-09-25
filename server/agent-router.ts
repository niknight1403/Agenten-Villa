import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import {
  configuredProviders,
  PROVIDER_NOTICE,
  runAgentTurn,
  runAgentTurnWithGitHub,
  safeAgentError,
  verifyOpenRouterKey,
} from "./agent-engine";
import {
  executeGitHubTool,
  GITHUB_REPOSITORY,
  GitHubToolError,
} from "./github-tools";
import {
  CAPABILITY_PACKS,
  DEFAULT_VILLA_ID,
  VILLA_NOTICE,
  getVillaSnapshot,
  routeProvider,
} from "./agent-villa";

let controlState: "RUNNING" | "STOPPED" = "STOPPED";
const usage = new Map<number, { start: number; count: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_TURNS_PER_WINDOW = 12;
const CREDENTIAL_CHECK_WINDOW_MS = 15 * 60 * 1000;
const MAX_CREDENTIAL_CHECKS = 5;
const credentialChecks = new Map<number, { start: number; count: number }>();
const githubUsage = new Map<number, { start: number; count: number }>();
const GITHUB_WINDOW_MS = 60 * 60 * 1000;
const MAX_GITHUB_TURNS_PER_WINDOW = 12;

function isAdmin(user: { role: string; email?: string | null }) {
  const allowlisted = process.env.AGENT_ADMIN_EMAIL?.trim().toLowerCase();
  return (
    user.role === "admin" ||
    Boolean(allowlisted && user.email?.trim().toLowerCase() === allowlisted)
  );
}
function requireAdmin(user: { role: string; email?: string | null }) {
  if (!isAdmin(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Nur der konfigurierte Administrator kann den Agenten steuern oder GitHub-Werkzeuge verwenden.",
    });
}
function consumeInWindow(
  store: Map<number, { start: number; count: number }>,
  userId: number,
  limit: number,
  windowMs: number,
  errorMessage: string
) {
  const now = Date.now();
  const current = store.get(userId);
  if (!current || now - current.start >= windowMs) {
    store.set(userId, { start: now, count: 1 });
    return;
  }
  if (current.count >= limit)
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: errorMessage });
  current.count += 1;
}
/** Pure peek at how many calls remain in the current window without consuming one. */
export function remainingInWindow(
  store: Map<number, { start: number; count: number }>,
  userId: number,
  limit: number,
  windowMs: number
) {
  const current = store.get(userId);
  const now = Date.now();
  if (!current || now - current.start >= windowMs) return limit;
  return Math.max(0, limit - current.count);
}

function windowResetAt(store: Map<number, { start: number; count: number }>, userId: number, windowMs: number) {
  const current = store.get(userId);
  const now = Date.now();
  if (!current || now - current.start >= windowMs) return null;
  return new Date(current.start + windowMs);
}

function consumeTurn(userId: number) {
  consumeInWindow(
    usage,
    userId,
    MAX_TURNS_PER_WINDOW,
    WINDOW_MS,
    "Das lokale Stundenlimit ist erreicht. Bitte später erneut versuchen."
  );
}
function consumeCredentialCheck(userId: number) {
  consumeInWindow(
    credentialChecks,
    userId,
    MAX_CREDENTIAL_CHECKS,
    CREDENTIAL_CHECK_WINDOW_MS,
    "Zu viele Schlüsselprüfungen. Bitte später erneut versuchen."
  );
}
function consumeGitHubTurn(userId: number) {
  consumeInWindow(
    githubUsage,
    userId,
    MAX_GITHUB_TURNS_PER_WINDOW,
    GITHUB_WINDOW_MS,
    "Das GitHub-Agentenlimit von zwölf Aufträgen pro Stunde ist erreicht."
  );
}

const inputSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(4_000),
        })
      )
      .max(20),
    mode: z.enum(["home", "workshop"]),
    specialty: z.string().max(80),
    allowHuggingFaceFallback: z.boolean().default(false),
    useGitHub: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.useGitHub && value.mode !== "workshop")
      ctx.addIssue({
        code: "custom",
        message:
          "GitHub-Werkzeuge sind nur in der Projekt-Werkstatt verfügbar.",
      });
  });

export const agentRouter = router({
  usage: protectedProcedure.query(({ ctx }) => ({
    remainingTurns: remainingInWindow(usage, ctx.user.id, MAX_TURNS_PER_WINDOW, WINDOW_MS),
    resetsAt: windowResetAt(usage, ctx.user.id, WINDOW_MS),
  })),
  status: protectedProcedure.query(({ ctx }) => ({
    state: controlState,
    isAdmin: isAdmin(ctx.user),
    providers: configuredProviders(),
    github: {
      configured: Boolean(process.env.GITHUB_TOKEN?.trim()),
      repository: GITHUB_REPOSITORY,
      actionsPerTurn: 3,
      turnsPerHour: MAX_GITHUB_TURNS_PER_WINDOW,
    },
    villa: getVillaSnapshot(DEFAULT_VILLA_ID),
    administrator: {
      fullProductAccess: isAdmin(ctx.user),
      canManageVilla: isAdmin(ctx.user),
      canUseProtectedTools: isAdmin(ctx.user),
    },
    providerRouting: routeProvider({
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      huggingFaceConfigured: Boolean(process.env.HF_TOKEN?.trim()),
      allowExplicitFallback: true,
    }),
    notice: PROVIDER_NOTICE,
    villaNotice: VILLA_NOTICE,
    limits: { turnsPerHour: MAX_TURNS_PER_WINDOW, providerCallsPerTurn: 2 },
  })),
  capabilityPacks: protectedProcedure.query(() => CAPABILITY_PACKS),
  villaSnapshot: protectedProcedure
    .input(
      z.object({
        villaId: z.string().trim().min(1).max(80).default(DEFAULT_VILLA_ID),
      })
    )
    .query(({ input }) => getVillaSnapshot(input.villaId)),
  setState: protectedProcedure
    .input(z.object({ state: z.enum(["RUNNING", "STOPPED"]) }))
    .mutation(({ ctx, input }) => {
      requireAdmin(ctx.user);
      controlState = input.state;
      return { state: controlState };
    }),
  testOpenRouterKey: protectedProcedure
    .input(z.object({ apiKey: z.string().trim().min(8).max(512) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user);
      consumeCredentialCheck(ctx.user.id);
      const status = await verifyOpenRouterKey(input.apiKey);
      return {
        status,
        message:
          status === "valid"
            ? "Authentifizierung erfolgreich. Der Schlüssel wurde nur für diese Prüfung verwendet und nicht gespeichert."
            : status === "invalid"
              ? "OpenRouter hat den Schlüssel abgewiesen. Bitte prüfe ihn und versuche es erneut. Der Schlüssel wurde nicht gespeichert."
              : "OpenRouter ist gerade nicht erreichbar oder begrenzt Prüfungen. Es wurde nichts gespeichert.",
      } as const;
    }),
  chat: protectedProcedure
    .input(inputSchema)
    .mutation(async ({ ctx, input }) => {
      if (controlState !== "RUNNING")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Der Agent steht auf STOPPED. Der Administrator muss ihn ausdrücklich starten.",
        });
      // Administrators have unrestricted application-level access. Provider
      // quotas, per-request safety caps, and external service policies still
      // apply and are never bypassed.
      if (!isAdmin(ctx.user)) consumeTurn(ctx.user.id);
      try {
        if (input.useGitHub) {
          requireAdmin(ctx.user);
          if (!process.env.GITHUB_TOKEN?.trim())
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Der GitHub-Token ist noch nicht im geschützten Server-Secret eingerichtet.",
            });
          if (!isAdmin(ctx.user)) consumeGitHubTurn(ctx.user.id);
          const result = await runAgentTurnWithGitHub(input, (name, args) =>
            executeGitHubTool(name, args)
          );
          return {
            ...result,
            workflow: [
              "Planung",
              "GitHub-Aktion",
              "Prüfung",
              "Zusammenfassung",
            ],
            notice:
              "GitHub-Aktionen sind auf dieses Repository beschränkt: maximal drei je Auftrag, höchstens zwölf Aufträge pro Stunde; Änderungen erfolgen ausschließlich auf agent/*-Branches und werden als Draft-PR geöffnet.",
          };
        }
        const result = await runAgentTurn(
          input,
          input.allowHuggingFaceFallback,
          { beforeFallback: async () => controlState === "RUNNING" }
        );
        return {
          ...result,
          workflow: ["Planung", "Transformation", "Prüfung", "Verbesserung"],
          notice: PROVIDER_NOTICE,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error instanceof GitHubToolError)
          throw new TRPCError({
            code:
              error.code === "NOT_CONFIGURED"
                ? "PRECONDITION_FAILED"
                : "BAD_GATEWAY",
            message: error.message,
          });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: safeAgentError(error),
        });
      }
    }),
});

export const agentControlLimits = {
  windowMs: WINDOW_MS,
  maxTurnsPerWindow: MAX_TURNS_PER_WINDOW,
} as const;
export const credentialCheckLimits = {
  windowMs: CREDENTIAL_CHECK_WINDOW_MS,
  maxChecks: MAX_CREDENTIAL_CHECKS,
} as const;
export const githubControlLimits = {
  windowMs: GITHUB_WINDOW_MS,
  maxTurnsPerWindow: MAX_GITHUB_TURNS_PER_WINDOW,
} as const;
export function resetAgentRouterForTests() {
  controlState = "STOPPED";
  usage.clear();
  credentialChecks.clear();
  githubUsage.clear();
}
export function getAgentRouterStateForTests() {
  return controlState;
}
export function isAgentAdminForTests(user: {
  role: string;
  email?: string | null;
}) {
  return isAdmin(user);
}
export function consumeTurnForTests(userId: number) {
  consumeTurn(userId);
}
export function consumeCredentialCheckForTests(userId: number) {
  consumeCredentialCheck(userId);
}
export function consumeGitHubTurnForTests(userId: number) {
  consumeGitHubTurn(userId);
}
export function setAgentStateForTests(state: "RUNNING" | "STOPPED") {
  controlState = state;
}
