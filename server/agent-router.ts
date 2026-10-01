import { buildForgePlan, forgeOptionsSchema } from "../shared/forge";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { router, protectedProcedure } from "./_core/trpc";
import {
  anyModelProviderConfigured,
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
  getEliteUnlimitedProjection,
  getVillaSnapshot,
  routeProvider,
} from "./agent-villa";
import {
  getGuardianSnapshot,
  runGuardianCycle,
  setGuardianEnabled,
  setGuardianIntervalMs,
} from "./provider-guardian";
import { getVilla } from "./villa-store";
import {
  findMissionByKey, finishMission, getMissionRun, listMissionRuns,
  missionLeaseIntervalMs, releaseActiveMission, renewMissionLease,
  reserveMission, restartInterruptedMission, type SavedMissionInput,
} from "./elite-mission-store";
import type { EliteMissionRun } from "../drizzle/schema";
import { fallbackOrder, listProviderCatalog } from "./provider-registry";
import {
  checkProviderHealth,
  type ProviderHealthStatus,
} from "./provider-health";

// The assistant is ready out of the box so a signed-in user can chat
// immediately. Administrators can still stop/start it via the controller.
let controlState: "RUNNING" | "STOPPED" = "RUNNING";
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

/**
 * Sprint 035 — Kontingentanzeige: Snapshot eines lokalen Fensters mit
 * genutzten und verbleibenden Aufrufen. Reines Nachschauen ohne Verbrauch.
 */
export interface WindowSnapshot {
  used: number;
  remaining: number;
  limit: number;
  active: boolean;
  resetsAt: Date | null;
}

export function windowSnapshot(
  store: Map<number, { start: number; count: number }>,
  userId: number,
  limit: number,
  windowMs: number,
  now = Date.now()
): WindowSnapshot {
  const current = store.get(userId);
  if (!current || now - current.start >= windowMs)
    return { used: 0, remaining: limit, limit, active: false, resetsAt: null };
  return {
    used: current.count,
    remaining: Math.max(0, limit - current.count),
    limit,
    active: true,
    resetsAt: new Date(current.start + windowMs),
  };
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
  forge: forgeOptionsSchema.optional(),
  idempotencyKey: z.uuid().optional(),
  villaId: z.number().int().positive().optional(),
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

type EliteOutput = Awaited<ReturnType<typeof runAutonomousProjectWithGitHub>> & {
  elite: true;
  plan: string;
  workflow: string[];
  notice: string;
  missionId: number;
};

function missionHash(input: z.infer<typeof eliteMissionSchema>) {
  return createHash("sha256").update(JSON.stringify({
    villaId: input.villaId ?? null, prompt: input.prompt,
    history: input.history, specialty: input.specialty,
    ...(input.forge ? { forge: input.forge } : {}),
  })).digest("hex");
}

function replayOrConflict(run: EliteMissionRun, expectedHash: string): EliteOutput {
  if (run.requestHash !== expectedHash)
    throw new TRPCError({ code: "CONFLICT", message: "Dieser Idempotenzschlüssel gehört zu einem anderen Missionsauftrag." });
  if (run.status === "completed" && run.result) return run.result as EliteOutput;
  throw new TRPCError({ code: "CONFLICT", message: `Mission ${run.id} ist ${run.status}. Status abfragen; unterbrochene Läufe nur nach Prüfung ausdrücklich neu starten.` });
}

async function executePersistedMission(run: EliteMissionRun, missionInput: SavedMissionInput): Promise<EliteOutput> {
  const heartbeat = setInterval(() => {
    void renewMissionLease(run).catch(() => { /* no secrets or history in logs */ });
  }, missionLeaseIntervalMs());
  heartbeat.unref?.();
  try {
    const result = await runAutonomousProjectWithGitHub(
      missionInput,
      async (name, args) => {
        if (!await renewMissionLease(run)) throw new Error("MISSION_OWNERSHIP_LOST");
        return executeGitHubTool(name, args);
      },
      { beforeFallback: async () => controlState === "RUNNING" && await renewMissionLease(run) }
    );
    const output: EliteOutput = {
      ...result,
      elite: true,
      plan: ELITE_PLAN.name,
      workflow: [
        "Repository analysieren", "Akzeptanzkriterien & Architektur", "agent/*-Branch",
        "Implementierung", "Tests & Dokumentation", "Selbstprüfung",
        "CI/PR-Status beobachten", "Draft-PR Übergabe",
      ],
      notice: "Elite-Missionen haben für Administratoren kein lokales Chat- oder Token-Gesamtkontingent. Der Lauf bleibt technisch begrenzt, damit er kontrollierbar ist: maximal 24 GitHub-Aktionen und 12 Werkzeugrunden pro Mission. Externe Modellkontingente, Kontextfenster, GitHub-Berechtigungen und Sicherheitsregeln werden nicht umgangen.",
      missionId: run.id,
    };
    await finishMission(run, output);
    return output;
  } catch (error) {
    // A lost lease is never overwritten by this attempt. The old GitHub side
    // effects may already exist and require manual review before restarting.
    try { await finishMission(run, null, "MISSION_FAILED"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    clearInterval(heartbeat);
    releaseActiveMission(run.id);
  }
}

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
      /**
       * Sprint 035 — Kontingentanzeige: genutzte und verbleibende lokale
       * Fenster. Administratoren sind unbegrenzt und sehen null.
       */
      windows: admin
        ? null
        : {
            turns: windowSnapshot(
              usage,
              ctx.user.id,
              MAX_TURNS_PER_WINDOW,
              WINDOW_MS
            ),
            github: windowSnapshot(
              githubUsage,
              ctx.user.id,
              MAX_GITHUB_TURNS_PER_WINDOW,
              GITHUB_WINDOW_MS
            ),
            credentialChecks: windowSnapshot(
              credentialChecks,
              ctx.user.id,
              MAX_CREDENTIAL_CHECKS,
              CREDENTIAL_CHECK_WINDOW_MS
            ),
          },
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
        groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      }),
      eliteUnlimited: admin ? getEliteUnlimitedProjection() : null,
      providerGuardian: admin ? getGuardianSnapshot() : null,
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

  /**
   * Sprint 031 — Providerregister: dokumentierte Faehigkeiten und
   * Statusfelder aller LLM-Anbieter. Nur lesbar; der Status wird ueber
   * die Betriebsumgebung gesetzt, nie vom Client.
   */
  providers: protectedProcedure.query(() => ({
    fallbackOrder: fallbackOrder(),
    entries: listProviderCatalog().map(entry => ({
      name: entry.name,
      status: entry.status,
      capabilities: entry.capabilities,
      consentRequired: entry.consentRequired,
      models: entry.models(),
      chatUrl: entry.chatUrl(),
      docsUrl: entry.docsUrl,
    })),
  })),
  guardian: protectedProcedure.query(({ ctx }) => {
    requireAdmin(ctx.user);
    return getGuardianSnapshot();
  }),
  runProviderGuardian: protectedProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user);
    return runGuardianCycle();
  }),
  setProviderGuardian: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        intervalMs: z.number().int().min(30_000).max(3_600_000).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      requireAdmin(ctx.user);
      if (input.enabled !== undefined) setGuardianEnabled(input.enabled);
      if (input.intervalMs !== undefined)
        setGuardianIntervalMs(input.intervalMs);
      return getGuardianSnapshot();
    }),
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
  /**
   * Sprint 036 — Provider-Gesundheitscheck: ungefährliche, begrenzte
   * Anfragen gegen die Status-Endpunkte der konfigurierten Anbieter.
   * Nur für Administratoren; Schlüssel bleiben serverseitig.
   */
  providerHealth: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["openrouter", "groq", "gemini", "huggingface"]),
        consentHuggingFace: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user);
      const result = await checkProviderHealth(input.provider, {
        consentHuggingFace: input.consentHuggingFace,
      });
      const messages: Record<ProviderHealthStatus, string> = {
        valid: "Der Anbieter ist erreichbar und hat den Schlüssel akzeptiert.",
        invalid:
          "Der Anbieter hat den Schlüssel abgewiesen. Bitte Konfiguration prüfen.",
        unavailable:
          "Der Anbieter ist gerade nicht erreichbar. Keine Daten gesendet worden außer dem Statusabruf.",
        not_configured:
          "Für diesen Anbieter ist kein serverseitiger Schlüssel konfiguriert.",
        consent_required:
          "Hugging Face wird nur nach ausdrücklicher Einwilligung geprüft und genutzt.",
      };
      return {
        provider: input.provider,
        status: result.status,
        cached: result.cached,
        message: messages[result.status],
      };
    }),
  testOpenRouterKey: protectedProcedure
    .input(z.object({ apiKey: z.string().trim().min(8).max(512) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user);
      // Administrators have no local application limit; the endpoint stays
      // admin-only and each call still hits the provider's own policy.
      if (!isAdmin(ctx.user)) consumeCredentialCheck(ctx.user.id);
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
  forgePlan: protectedProcedure
    .input(forgeOptionsSchema)
    .query(({ ctx, input }) => {
      requireAdmin(ctx.user);
      return buildForgePlan(input);
    }),
  eliteMission: protectedProcedure
    .input(eliteMissionSchema)
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.user);
      const key = input.idempotencyKey ?? randomUUID();
      const requestHash = missionHash(input);
      try {
        // Completed requests can be replayed without a provider call even if
        // the agent is currently stopped or its provider has become unavailable.
        if (input.idempotencyKey) {
          const previous = await findMissionByKey(ctx.user.id, key);
          if (previous) return replayOrConflict(previous, requestHash);
        }
      } catch (error) {
        mapAgentError(error);
      }
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
      if (!anyModelProviderConfigured())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Für autonome Projektmissionen muss mindestens ein Modellanbieter-Secret eingerichtet sein (OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY oder HF_TOKEN).",
        });

      try {
        const villa = input.villaId ? await getVilla(input.villaId, ctx.user.id) : null;
        if (input.villaId && !villa)
          throw new TRPCError({ code: "NOT_FOUND", message: "Projekt-Villa nicht gefunden." });
        if (villa?.archivedAt)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Diese Villa ist archiviert und startet keine neuen Läufe.",
          });
        const projectContext = villa
          ? `Projekt-Villa: ${villa.name}\nProjektziel: ${villa.projectBrief ?? "Noch nicht beschrieben"}\n\n`
          : "";
        if (projectContext.length + input.prompt.length > ELITE_LIMITS.promptChars)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Projektziel und Mission sind zusammen zu lang. Bitte kürzer formulieren." });
        const missionInput: SavedMissionInput = {
          prompt: `${projectContext}${input.prompt}`,
          history: input.history,
          mode: "workshop" as const,
          specialty: input.specialty,
          ...(input.forge ? { forge: input.forge } : {}),
          ...(adminSystemPrompt
            ? { systemOverride: adminSystemPrompt }
            : {}),
        };
        const reservation = await reserveMission({ userId: ctx.user.id, idempotencyKey: key, requestHash, missionInput });
        if (!reservation.created) return replayOrConflict(reservation.run, requestHash);
        return await executePersistedMission(reservation.run, missionInput);
      } catch (error) {
        mapAgentError(error);
      }
    }),
  eliteMissionRuns: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    try {
      const rows = await listMissionRuns(ctx.user.id);
      return rows.map(({ id, idempotencyKey, status, attempt, createdAt, updatedAt, finishedAt }) =>
        ({ id, idempotencyKey, status, attempt, createdAt, updatedAt, finishedAt }));
    } catch (error) { mapAgentError(error); }
  }),
  eliteMissionRun: protectedProcedure.input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.user);
      try {
        const run = await getMissionRun(input.id, ctx.user.id);
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Mission nicht gefunden." });
        return { id: run.id, status: run.status, attempt: run.attempt,
          result: run.status === "completed" ? run.result as EliteOutput : null,
          createdAt: run.createdAt, updatedAt: run.updatedAt, finishedAt: run.finishedAt };
      } catch (error) { mapAgentError(error); }
    }),
  restartInterruptedMission: protectedProcedure.input(z.object({
    id: z.number().int().positive(),
    acknowledgeExternalChanges: z.literal(true),
  })).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    if (controlState !== "RUNNING" || !process.env.GITHUB_TOKEN?.trim() || !anyModelProviderConfigured())
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent und Provider-Zugang müssen für einen ausdrücklich neu gestarteten Versuch bereit sein." });
    try {
      const run = await restartInterruptedMission(input.id, ctx.user.id);
      if (!run) throw new TRPCError({ code: "CONFLICT", message: "Die Mission ist nicht unterbrochen, die Lease läuft noch, oder der Auftrag gehört einem anderen Konto." });
      return await executePersistedMission(run, run.input as SavedMissionInput);
    } catch (error) { mapAgentError(error); }
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
  controlState = "RUNNING";
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
