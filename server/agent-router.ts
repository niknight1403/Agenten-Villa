import { buildForgePlan, forgeOptionsSchema } from "../shared/forge";
import { workforceDirective } from "../shared/villa-workforce";
import { TRPCError } from "@trpc/server";
import { consumeAdminMutation } from "./admin-rate-limit";
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
  isReadOnlyGitHubTool,
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
import { advisorStatsSchema } from "@shared/storage-advisor";
import { runStorageAdvisor } from "./storage-advisor";
import {
  findMissionByKey, finishMission, getMissionRun, listMissionRuns,
  MAX_MISSION_ATTEMPTS, missionRetryExhausted,
  missionLeaseIntervalMs, releaseActiveMission, renewMissionLease,
  reserveMission, restartInterruptedMission, type SavedMissionInput,
} from "./elite-mission-store";
import type { EliteMissionRun } from "../drizzle/schema";
import { fallbackOrder, listProviderCatalog } from "./provider-registry";
import {
  checkProviderHealth,
  type ProviderHealthStatus,
} from "./provider-health";
import { routerTelemetrySummary } from "./router-telemetry";
import { getPackCatalog } from "./pack-catalog";
import { requireApproval } from "./approval-gates";
import { resolveAgentRole, requireRole, ROLE_RANK, type AgentRole } from "./roles";
import { recordAuditEntry, listAuditEntries, auditLogSize } from "./audit-log";
import { agentMetricsSummary, instrumentAgentRun, type AgentRunKind } from "./agent-metrics";
import { villaController } from "./controller";

// The assistant is ready out of the box so a signed-in user can chat
// immediately. Administrators can still stop/start it via the controller.
let controlState: "RUNNING" | "STOPPED" = "RUNNING";
import { activePrompt, commitPromptVersion, listPromptVersions, rollbackPromptVersion } from "./prompt-versions";
import { resetPromptVersionsForTests } from "./prompt-versions";
import type { PromptVersion } from "./prompt-versions";
const usage = new Map<number, { start: number; count: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_TURNS_PER_WINDOW = 12;
const CREDENTIAL_CHECK_WINDOW_MS = 15 * 60 * 1000;
const MAX_CREDENTIAL_CHECKS = 5;
const credentialChecks = new Map<number, { start: number; count: number }>();
const githubUsage = new Map<number, { start: number; count: number }>();
const GITHUB_WINDOW_MS = 60 * 60 * 1000;
const MAX_GITHUB_TURNS_PER_WINDOW = 12;

// Live-Fortschritt pro Konto: echte Meilensteine eines laufenden Chat-
// Auftrags (Modellaufrufe, Anbieterwechsel, GitHub-Aktionen). Der Client
// pollt agent.progress, während die Chat-Mutation läuft. Einträge werden
// nach Abschluss gelöscht; verwaiste Einträge räumt die Query ab.
type ProgressEvent = { seq: number; label: string; at: string };
type LiveProgress = {
  prompt: string;
  startedAt: string;
  events: ProgressEvent[];
};
const liveProgress = new Map<number, LiveProgress>();
const LIVE_PROGRESS_TTL_MS = 15 * 60 * 1000;
function beginProgress(userId: number, prompt: string) {
  liveProgress.set(userId, { prompt, startedAt: new Date().toISOString(), events: [{ seq: 1, label: "Auftrag beim Superagenten eingegangen", at: new Date().toISOString() }] });
}
function progressEmitter(userId: number) {
  let seq = 1;
  return (label: string) => {
    const entry = liveProgress.get(userId);
    if (!entry) return;
    seq += 1;
    entry.events.push({ seq, label, at: new Date().toISOString() });
    if (entry.events.length > 30) entry.events.splice(0, entry.events.length - 30);
  };
}
function finishProgress(userId: number) {
  liveProgress.delete(userId);
}
function staleProgressCleanup() {
  const now = Date.now();
  liveProgress.forEach((entry, userId) => {
    if (now - new Date(entry.startedAt).getTime() > LIVE_PROGRESS_TTL_MS)
      liveProgress.delete(userId);
  });
}

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
/**
 * Sprint 056 — Admin-Mutationen: Rollenpruefung UND per-Nutzer-Budget.
 * Lesende Admin-Abfragen (Telemetrie, Metriken, Audit) bleiben unbegrenzt.
 */
function requireAdminMutation(
  user: { id?: number; role: string; email?: string | null }
) {
  requireAdmin(user);
  if (typeof user.id === "number") consumeAdminMutation(user.id);
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
  // Sprint 047 — Human-in-the-loop: der Start einer Elite-Mission ist ein
  // Freigabepunkt; requireApproval prueft die Quittung mit klarem Text.
  acknowledgeImpact: z.boolean(),
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

async function executePersistedMission(
  run: EliteMissionRun,
  missionInput: SavedMissionInput,
  metricKind: AgentRunKind = "elite"
): Promise<EliteOutput> {
  const heartbeat = setInterval(() => {
    void renewMissionLease(run).catch(() => { /* no secrets or history in logs */ });
  }, missionLeaseIntervalMs());
  heartbeat.unref?.();
  try {
    // Sprint 044 — Missionskontexte sind gegeneinander isoliert: die
    // Missions-Identität reist mit dem Auftrag und namespaced Cache/Dedupe.
    // Sprint 048 — Agentenmetriken: Laufzeit, Fehler und Ergebnisstatus.
    const result = await instrumentAgentRun(
      metricKind,
      runResult => runResult.completed,
      () => runAutonomousProjectWithGitHub(
        { ...missionInput, missionId: String(run.id) },
        async (name, args) => {
          if (!await renewMissionLease(run)) throw new Error("MISSION_OWNERSHIP_LOST");
          return executeGitHubTool(name, args);
        },
        {
          beforeFallback: async () => controlState === "RUNNING" && await renewMissionLease(run),
          // Sprint 043 — Elite-Missionen sind administratoren-only; die
          // explizite Autorisierung reicht die geprüfte Rolle an die
          // Werkzeugrunde weiter.
          authorization: { administrator: true },
        }
      )
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
  /**
   * Sprint 042 — Capability-Packs: der schema-validierte Katalog mit
   * Zweck, Berechtigungen und Grenzen jedes Packs. Für alle Nutzer lesbar.
   */
  packs: protectedProcedure.query(() => getPackCatalog()),
  /**
   * Sprint 038 — Router-Telemetrie: aggregierte Latenz, Erfolg und
   * Fallback-Gruende. Nur für Administratoren; ohne Nutzdaten.
   */
  routerTelemetry: protectedProcedure.query(({ ctx }) => {
    requireAdmin(ctx.user);
    return routerTelemetrySummary();
  }),
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
    // Sprint 051 — Rollenmodell: Administrator, Operator, Viewer getrennt.
    const role = resolveAgentRole(ctx.user);
    return {
      state: controlState,
      isAdmin: admin,
      role,
      canControl: ROLE_RANK[role] >= ROLE_RANK.operator,
      systemPrompt: activePrompt(),
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
    requireAdminMutation(ctx.user);
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
      requireAdminMutation(ctx.user);
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
    .input(z.object({ state: z.enum(["RUNNING", "STOPPED"]), acknowledgeStop: z.literal(true).optional() }))
    .mutation(({ ctx, input }) => {
      // Sprint 051 — Rollenmodell: Operatoren steuern den Betrieb,
      // Administratoren ebenso; Viewer bleiben ausgesperrt.
      requireRole(ctx.user, "operator");
      // Sprint 047 — Freigabepunkt: Anhalten nur mit ausdrücklicher Quittung.
      requireApproval("controller-stop", input.state !== "STOPPED" || input.acknowledgeStop === true);
      controlState = input.state;
      // Sprint — 24/7-Watchdog: der Loop folgt dem Mastervillage-Zustand.
      // Watchdog-Fehler blockieren die genehmigte Betriebsentscheidung nie.
      if (process.env.NODE_ENV !== "test") {
        void (input.state === "RUNNING"
          ? villaController.start()
          : villaController.stop()
        ).catch(() => { /* nur Diagnose-Loop, nie betriebskritisch */ });
      }
      // Sprint 052 — Audit-Log: kritische Änderungen besitzen Zeit, Nutzer und Aktion.
      recordAuditEntry({
        userId: ctx.user.id,
        userEmail: ctx.user.email ?? null,
        action: "controller_state_set",
        details: `Betriebszustand auf ${input.state} gesetzt (Quittung erteilt).`,
      });
      return { state: controlState };
    }),
  setSystemPrompt: protectedProcedure
    .input(z.object({ prompt: z.string().max(4000).nullable() }))
    .mutation(({ ctx, input }) => {
      requireAdminMutation(ctx.user);
      const trimmed = input.prompt?.trim() ?? "";
      // Sprint 049 — jede Änderung wird als versionierter Eintrag
      // aufgezeichnet und ist über den Verlauf nachvollziehbar.
      const version = commitPromptVersion(
        trimmed ? trimmed : null,
        ctx.user.email ?? "unbekannt"
      );
      // Sprint 052 — Audit-Log: Prompt-Änderungen sind nachvollziehbar.
      recordAuditEntry({
        userId: ctx.user.id,
        userEmail: ctx.user.email ?? null,
        action: "system_prompt_set",
        details: `Systemprompt auf Version ${version.version} gesetzt (${trimmed ? "geändert" : "geleert"}).`,
      });
      return { systemPrompt: version.prompt, version: version.version };
    }),
  // Sprint 049 — Prompt- und Kontextversionierung: Verlauf und Rollback.
  promptVersions: protectedProcedure.query(({ ctx }) => {
    requireAdmin(ctx.user);
    return listPromptVersions();
  }),
  /**
   * Sprint 052 — Audit-Log: kritische Änderungen mit Zeit, Nutzer und
   * Aktion, newest-first. Nur für Administratoren abrufbar.
   */
  auditLog: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(200).default(50) }))
    .query(({ ctx, input }) => {
      requireAdmin(ctx.user);
      return { entries: listAuditEntries(input.limit), total: auditLogSize() };
    }),
  rollbackPromptVersion: protectedProcedure
    .input(z.object({ version: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      requireAdminMutation(ctx.user);
      const version = rollbackPromptVersion(input.version, ctx.user.email ?? "unbekannt");
      // Sprint 052 — Audit-Log: Rollbacks sind nachvollziehbar.
      recordAuditEntry({
        userId: ctx.user.id,
        userEmail: ctx.user.email ?? null,
        action: "system_prompt_rollback",
        details: `Systemprompt auf Version ${input.version} zurückgesetzt; neue Version ${version.version}.`,
      });
      return { systemPrompt: version.prompt, version: version.version };
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
      requireAdminMutation(ctx.user);
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
      requireAdminMutation(ctx.user);
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
      requireAdminMutation(ctx.user);
      // Sprint 047 — Freigabepunkt: echte GitHub-Aktionen nur mit Quittung.
      requireApproval("mission-start", input.acknowledgeImpact);
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
        // Villa-Belegschaft: jede Mission beginnt mit der Einweisung
        // der 1000 logischen Agenten in ihre Aufgabenbereiche.
        const projectContext = `${
          villa
            ? `Projekt-Villa: ${villa.name}\nProjektziel: ${villa.projectBrief ?? "Noch nicht beschrieben"}\n\n`
            : ""
        }${workforceDirective(villa?.name ?? null)}\n\n`;
        if (projectContext.length + input.prompt.length > ELITE_LIMITS.promptChars)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Projektziel und Mission sind zusammen zu lang. Bitte kürzer formulieren." });
        const missionInput: SavedMissionInput = {
          prompt: `${projectContext}${input.prompt}`,
          history: input.history,
          mode: "workshop" as const,
          specialty: input.specialty,
          ...(input.forge ? { forge: input.forge } : {}),
          ...(activePrompt()
            ? { systemOverride: activePrompt() }
            : {}),
        };
        const reservation = await reserveMission({ userId: ctx.user.id, idempotencyKey: key, requestHash, missionInput });
        if (!reservation.created) return replayOrConflict(reservation.run, requestHash);
        // Sprint 048 — auch der Neustart wird als Lauf mit Metriken erfasst.
        return await executePersistedMission(reservation.run, missionInput, "elite-restart");
      } catch (error) {
        mapAgentError(error);
      }
    }),
  // Sprint 048 — Agentenmetriken: Laufzeit, Fehler und Ergebnisstatus.
  agentMetrics: protectedProcedure.query(({ ctx }) => {
    requireAdmin(ctx.user);
    return agentMetricsSummary();
  }),
  eliteMissionRuns: protectedProcedure.query(async ({ ctx }) => {
    requireAdminMutation(ctx.user);
    try {
      const rows = await listMissionRuns(ctx.user.id);
      return rows.map(({ id, idempotencyKey, status, attempt, createdAt, updatedAt, finishedAt }) =>
        ({ id, idempotencyKey, status, attempt, createdAt, updatedAt, finishedAt }));
    } catch (error) { mapAgentError(error); }
  }),
  eliteMissionRun: protectedProcedure.input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requireAdminMutation(ctx.user);
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
    requireAdminMutation(ctx.user);
    // Sprint 047 — Freigabepunkt: Neustart nur nach ausdrücklicher Prüfung.
    requireApproval("mission-restart", input.acknowledgeExternalChanges);
    if (controlState !== "RUNNING" || !process.env.GITHUB_TOKEN?.trim() || !anyModelProviderConfigured())
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Agent und Provider-Zugang müssen für einen ausdrücklich neu gestarteten Versuch bereit sein." });
    try {
      const run = await restartInterruptedMission(input.id, ctx.user.id);
      if (!run) {
        // Sprint 045 — Retry-Regeln: ist das Wiederholungslimit erreicht,
        // bleibt die Mission endgültig unterbrochen (kein weiterer Lauf,
        // keine weiteren GitHub-Nebenwirkungen).
        const existing = await getMissionRun(input.id, ctx.user.id);
        if (existing && missionRetryExhausted(existing))
          throw new TRPCError({ code: "CONFLICT", message: "Die Mission hat ihr Wiederholungslimit von " + String(MAX_MISSION_ATTEMPTS) + " Versuchen erreicht und bleibt endgültig unterbrochen. Bitte eine neue Mission starten." });
        throw new TRPCError({ code: "CONFLICT", message: "Die Mission ist nicht unterbrochen, die Lease läuft noch, oder der Auftrag gehört einem anderen Konto." });
      }
      return await executePersistedMission(run, run.input as SavedMissionInput, "elite-restart");
    } catch (error) { mapAgentError(error); }
  }),
  /**
   * Sprint 053 — Speicher-Berater: schmaler Agent-Pfad mit dem gleichen
   * Schutz wie chat (STOPPED-Zustand, Stundenkontingent), aber ohne
   * GitHub-Werkzeuge und mit strikter JSON-Validierung. Der Client sendet
   * NUR anonymisierte Statistiken — Dateinamen erreichen den Server nie.
   */
  storageAdvisor: protectedProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(1).max(500),
        stats: advisorStatsSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (controlState !== "RUNNING")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Der Agent steht auf STOPPED. Der Administrator muss ihn ausdrücklich starten.",
        });
      if (!isAdmin(ctx.user)) consumeTurn(ctx.user.id);
      try {
        return await runStorageAdvisor(input);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("ADVISOR_"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Der Speicher-Berater konnte keine gueltigen Vorschlaege erzeugen. Bitte den Auftrag konkreter formulieren.",
          });
        mapAgentError(error);
      }
    }),
  /**
   * Repo-Import-Analyse (Sprint Belegschaft): Bevor der Nutzer zwischen
   * OPTIMIZE und REBUILD waehlt, analysiert eine Villa das verbundene
   * Repository ausschliesslich mit LESenden GitHub-Werkzeugen und legt
   * dem Nutzer die Fertigstell-Moeglichkeiten mit klarer Empfehlung
   * vor. Keine Schreibvorgänge, keine Branches, keine PRs — reine Analyse.
   */
  forgeAnalysis: protectedProcedure
    .input(
      z.object({
        villaId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireAdminMutation(ctx.user);
      if (controlState !== "RUNNING")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Der Agent steht auf STOPPED. Vor einer Analyse starten.",
        });
      if (!process.env.GITHUB_TOKEN?.trim())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Für die Repository-Analyse muss GITHUB_TOKEN als Server-Secret eingerichtet sein.",
        });
      if (!anyModelProviderConfigured())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Für die Repository-Analyse muss mindestens ein Modellanbieter-Secret eingerichtet sein.",
        });
      let villaName: string | null = null;
      if (input.villaId) {
        const villa = await getVilla(input.villaId, ctx.user.id);
        if (!villa)
          throw new TRPCError({ code: "NOT_FOUND", message: "Projekt-Villa nicht gefunden." });
        if (villa.archivedAt)
          throw new TRPCError({ code: "FORBIDDEN", message: "Diese Villa ist archiviert und startet keine neuen Läufe." });
        villaName = villa.name;
      }
      const analysisPrompt = [
        `Analysiere das verbundene Repository ${GITHUB_REPOSITORY} fuer eine Projekt-Villa${villaName ? ` ('${villaName}')` : ""}.`,
        "Untersuche mit LESenden Werkzeugen: Repository-Ueberblick, Dateibaum, letzte Commits, offene Issues und Pull Requests sowie CI-Check-Runs.",
        "Bewerte ehrlich: Projektzustand, Architektur, Test- und CI-Situation, erkennbare Luecken.",
        "Lege dem Nutzer danach genau zwei Fertigstell-Moeglichkeiten vor, jede mit kurzer Begruendung und Konsequenz:",
        "1) OPTIMIZE — das bestehende Projekt weiterentwickeln, verbessern und optimieren.",
        "2) REBUILD — einen begruendeten Neubau als neues Projekt planen.",
        "Empfehlungspflicht: Nenne die aus deiner Analyse besser geeignete Option als klare Empfehlung.",
        "Beende die Antwort zwingend mit einer eigenen Zeile im Format 'EMPFEHLUNG: OPTIMIZE' oder 'EMPFEHLUNG: REBUILD'.",
      ].join(" ");
      beginProgress(ctx.user.id, analysisPrompt);
      try {
        const result = await runAgentTurnWithGitHub(
          activePrompt()
            ? { prompt: analysisPrompt, history: [], mode: "workshop", specialty: "Projektanalyse", systemOverride: activePrompt() }
            : { prompt: analysisPrompt, history: [], mode: "workshop", specialty: "Projektanalyse" },
          (name, args) => {
            if (!isReadOnlyGitHubTool(name))
              throw new Error(
                "READ_ONLY_ANALYSE: Diese Analysephase darf nur lesende GitHub-Werkzeuge ausführen."
              );
            return executeGitHubTool(name, args);
          },
          { authorization: { administrator: true }, onEvent: progressEmitter(ctx.user.id) }
        );
        const match = /EMPFEHLUNG:\s*(OPTIMIZE|REBUILD)/.exec(result.answer);
        return {
          answer: result.answer,
          recommendation: (match?.[1] as "OPTIMIZE" | "REBUILD" | undefined) ?? null,
          repository: GITHUB_REPOSITORY,
          model: result.model,
          githubActions: result.githubActions ?? 0,
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
      beginProgress(ctx.user.id, input.prompt);
      const emitProgress = progressEmitter(ctx.user.id);
      try {
        if (input.useGitHub) {
          requireAdminMutation(ctx.user);
          if (!process.env.GITHUB_TOKEN?.trim())
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Der GitHub-Token ist noch nicht im geschützten Server-Secret eingerichtet.",
            });
          if (!isAdmin(ctx.user)) consumeGitHubTurn(ctx.user.id);
          const result = await runAgentTurnWithGitHub(
            activePrompt()
              ? { ...input, systemOverride: activePrompt() }
              : input,
            (name, args) => executeGitHubTool(name, args),
            // Sprint 043 — requireAdmin hat den Aufrufer bereits geprüft;
            // die explizite Autorisierung macht die Werkzeugrunde nicht von
            // außengerufenen Annahmen abhängig.
            { authorization: { administrator: true }, onEvent: emitProgress }
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
        // Sprint 037 — Fail-closed bei fehlender Berechtigung: Explizit
        // angeforderter Hugging-Face-Fallback ohne HF_TOKEN wird NIEMALS
        // still auf andere Anbieter umgeleitet.
        if (input.allowHuggingFaceFallback && !process.env.HF_TOKEN?.trim())
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Hugging Face wurde ausdrücklich als Fallback angefragt, aber HF_TOKEN ist nicht als Server-Secret eingerichtet. Es erfolgt keine stille Umleitung auf andere Anbieter.",
          });
        const result = await runAgentTurn(
          activePrompt()
            ? { ...input, systemOverride: activePrompt() }
            : input,
          input.allowHuggingFaceFallback,
          {
            beforeFallback: async () => controlState === "RUNNING",
            onEvent: emitProgress,
          }
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
      } finally {
        finishProgress(ctx.user.id);
      }
    }),
  /**
   * Live-Fortschritt: Ereignisse des aktuell laufenden Chat-Auftrags des
   * eigenen Kontos. Liefert null, wenn gerade kein Auftrag läuft.
   */
  progress: protectedProcedure.query(({ ctx }) => {
    staleProgressCleanup();
    return liveProgress.get(ctx.user.id) ?? null;
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
  resetPromptVersionsForTests();
  controlState = "RUNNING";
  liveProgress.clear();
  resetPromptVersionsForTests();
  usage.clear();
  credentialChecks.clear();
  githubUsage.clear();
}

export function getAdminSystemPromptForTests() {
  return activePrompt();
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
