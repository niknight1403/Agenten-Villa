import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import {
  configuredProviders,
  ELITE_LIMITS,
  PROVIDER_NOTICE,
  runAgentTurn,
  runAgentTurnWithGitHub,
  runAutonomousProjectWithGitHub,
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
  ELITE_PLAN,
  VILLA_NOTICE,
  getEliteConnectorSnapshot,
  getVillaSnapshot,
  routeProvider,
} from "./agent-villa";

let controlState: "RUNNING" | "STOPPED" = "STOPPED";
let adminSystemPrompt: string | null = null;
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
        "Nur der konfigurierte Administrator kann den Agenten steuern oder geschützte Elite-/GitHub-Werkzeuge verwenden.",
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

function windowResetAt(
  store: Map<number, { start: number; count: number }>,
  userId: number,
  windowMs: number
) {
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

const historySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4_000),
    })
  )
  .max(20);

const inputSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    history: historySchema,
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

const eliteMissionSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3)
    .max(ELITE_LIMITS.promptChars),
  history: historySchema.default([]),
  specialty: z
    .string()
    .trim()
    .max(80)
    .default("Autonomous Product Engineering"),
});

function mapAgentError(error: unknown): never {
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

export const agentRouter = router({
  usage: protectedProcedure.query(({ ctx }) => {
    const admin = isAdmin(ctx.user);
    return {
      remainingTurns: admin
        ? null
        : remainingInWindow(
            usage,
            ctx.user.id,
            MAX_TURNS_PER_WINDOW,
            WINDOW_MS
          ),
      resetsAt: admin
        ? null
        : windowResetAt(usage, ctx.user.id, WINDOW_MS),
      unlimited: admin,
    };
  }),
  status: protectedProcedure.query(({ ctx }) => {
    const admin = isAdmin(ctx.user);
    return {
      state: controlState,
      isAdmin: admin,
      systemPrompt: adminSystemPrompt,
      providers: configuredProviders(),
      github: {
        configured: Boolean(process.env.GITHUB_TOKEN?.trim()),
        repository: GITHUB_REPOSITORY,
        actionsPerTurn: 3,
        actionsPerEliteMission: ELITE_LIMITS.githubActionsPerMission,
        turnsPerHour: admin ? null : MAX_GITHUB_TURNS_PER_WINDOW,
        protectedDelivery: "agent/* -> Draft PR" as const,
      },
      villa: getVillaSnapshot(DEFAULT_VILLA_ID),
      connectors: getEliteConnectorSnapshot(),
      administrator: {
        fullProductAccess: admin,
        canManageVilla: admin,
        canUseProtectedTools: admin,
        eliteEnabled: admin && ELITE_PLAN.enabled,
        plan: admin ? ELITE_PLAN.name : null,
        unlimitedLocalTurns: admin,
        unlimitedLocalTokenQuota: admin,
        autonomousProjectMissions: admin,
      },
      providerRouting: routeProvider({
        openRouterConfigured: Boolean(
          process.env.OPENROUTER_API_KEY?.trim()
        ),
        huggingFaceConfigured: Boolean(process.env.HF_TOKEN?.trim()),
        allowExplicitFallback: true,
      }),
      notice: PROVIDER_NOTICE,
      villaNotice: VILLA_NOTICE,
      limits: {
        turnsPerHour: admin ? null : MAX_TURNS_PER_WINDOW,
        localTokenQuota: admin ? null : "provider-request-dependent",
        standardProviderCallsPerTurn: 2,
        eliteGitHubActionsPerMission:
          ELITE_LIMITS.githubActionsPerMission,
        eliteToolRounds: ELITE_LIMITS.githubToolRounds,
        externalProviderLimitsApply: true,
      },
    };
  }),
  capabilityPacks: protectedProcedure.query(() => CAPABILITY_PACKS),
  eliteConnectors: protectedProcedure.query(({ ctx }) => {
    requireAdmin(ctx.user);
    return getEliteConnectorSnapshot();
  }),
  villaSnapshot: protectedProcedure
    .input(
      z.object({
        villaId: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .default(DEFAULT_VILLA_ID),
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
  setSystemPrompt: protectedProcedure
    .input(z.object({ prompt: z.string().max(4000).nullable() }))
    .mutation(({ ctx, input }) => {
      requireAdmin(ctx.user);
      const trimmed = input.prompt?.trim() ?? "";
      adminSystemPrompt = trimmed ? trimmed : null;
      return { systemPrompt: adminSystemPrompt };
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
  eliteMission: protectedProcedure
    .input(eliteMissionSchema)
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user);
      if (controlState !== "RUNNING")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Der Superagent steht auf STOPPED. Starte ihn vor einer Elite-Mission.",
        });
      if (!process.env.GITHUB_TOKEN?.trim())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Für autonome Projektmissionen muss GITHUB_TOKEN als geschütztes Server-Secret eingerichtet sein.",
        });
      if (!process.env.OPENROUTER_API_KEY?.trim())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Für autonome Projektmissionen muss OPENROUTER_API_KEY als geschütztes Server-Secret eingerichtet sein.",
        });

      try {
        const missionInput = {
          prompt: input.prompt,
          history: input.history,
          mode: "workshop" as const,
          specialty: input.specialty,
          ...(adminSystemPrompt
            ? { systemOverride: adminSystemPrompt }
            : {}),
        };
        const result = await runAutonomousProjectWithGitHub(
          missionInput,
          (name, args) => executeGitHubTool(name, args),
          { beforeFallback: async () => controlState === "RUNNING" }
        );
        return {
          ...result,
          elite: true,
          plan: ELITE_PLAN.name,
          workflow: [
            "Repository analysieren",
            "Akzeptanzkriterien & Architektur",
            "agent/*-Branch",
            "Implementierung",
            "Tests & Dokumentation",
            "Selbstprüfung",
            "CI/PR-Status beobachten",
            "Draft-PR Übergabe",
          ],
          notice:
            "Elite-Missionen haben für Administratoren kein lokales Chat- oder Token-Gesamtkontingent. Der Lauf bleibt technisch begrenzt, damit er kontrollierbar ist: maximal 24 GitHub-Aktionen und 12 Werkzeugrunden pro Mission. Externe Modellkontingente, Kontextfenster, GitHub-Berechtigungen und Sicherheitsregeln werden nicht umgangen.",
        };
      } catch (error) {
        mapAgentError(error);
      }
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
          const result = await runAgentTurnWithGitHub(
            adminSystemPrompt
              ? { ...input, systemOverride: adminSystemPrompt }
              : input,
            (name, args) => executeGitHubTool(name, args)
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
              "Standard-GitHub-Modus: maximal drei Aktionen je Auftrag. Für vollständige Idee-zu-Projekt-Umsetzungen steht Administratoren zusätzlich agent.eliteMission mit bis zu 24 kontrollierten GitHub-Aktionen zur Verfügung. Änderungen erfolgen ausschließlich auf agent/*-Branches und als Draft-PR.",
          };
        }
        const result = await runAgentTurn(
          adminSystemPrompt
            ? { ...input, systemOverride: adminSystemPrompt }
            : input,
          input.allowHuggingFaceFallback,
          { beforeFallback: async () => controlState === "RUNNING" }
        );
        return {
          ...result,
          workflow: [
            "Planung",
            "Transformation",
            "Prüfung",
            "Verbesserung",
          ],
          notice: PROVIDER_NOTICE,
        };
      } catch (error) {
        mapAgentError(error);
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
  adminSystemPrompt = null;
  usage.clear();
  credentialChecks.clear();
  githubUsage.clear();
}

export function getAdminSystemPromptForTests() {
  return adminSystemPrompt;
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
