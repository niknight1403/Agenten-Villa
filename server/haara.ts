/**
 * Sprint 103 — HAARA: Autonomous High-Availability Architecture
 * (CyberSarah Control Center, Master-Prompt Abschnitt 2.1).
 *
 * HAARA aggregiert die bestehenden Gesundheitssysteme (Route-Rotator,
 * Provider-Cooldowns, DB-Health) zu einer Eskalations-Stufenmaschine:
 *
 *   healthy       – alles gruen: aktive Route, DB verbunden, kein Cooldown.
 *   degraded      – es fehlt etwas (Cooldowns, ungesunde Routen), aber es
 *                   bedient noch eine Route.
 *   self_healing  – degraded UND der Tick hat Selbstheilungs-Massnahmen
 *                   angewendet (Routenwechsel erzwingen, Cooldown-Probe,
 *                   DB-Reconnect-Probe, Prompt-Degradation).
 *   critical      – keine aktive Route mehr ODER Datenbank "fehler".
 *
 * Alle Entscheidungen faellt die reine Funktion assessHaara(); der
 * Orchestrator haaraTick() sammelt Signale, wendet Heilaktionen an und
 * protokolliert den Verlauf. Backpressure ersetzt echtes Auto-Scaling
 * (Render Free Tier skaliert nicht horizontal): begrenzte Concurrency
 * mit Retry-Empfehlung statt offener Lastverarbeitung.
 */

import { getRotationStatus, runRotationTick, type RotationStatus } from "./route-rotator";
import { activeRouteFromConfig } from "./active-route";
import { checkDatabaseHealth, type DatabaseHealthReport } from "./db-health";
import { providerCooldownSnapshot } from "./provider-cooldown";

/* ------------------------------------------------------------------ */
/* Typen                                                              */
/* ------------------------------------------------------------------ */

export type HaaraLevel = "healthy" | "degraded" | "self_healing" | "critical";

export type HaaraSignal = {
  /** Route, die aktuell bedient (null = keine). */
  activeRoute: string | null;
  /** Routen-Status aus dem Rotator (kann null sein: noch kein Tick). */
  rotation: Pick<RotationStatus, "rankedRoutes" | "routes"> | null;
  /** Aktive Provider-Cooldowns. */
  cooldowns: Array<{ provider: string; kind: string; untilMs: number }>;
  /** Datenbank-Status (null = noch nicht geprüft). */
  database: Pick<DatabaseHealthReport, "status"> | null;
  /** Zeitstempel (ms) der Bewertung. */
  now: number;
};

export type HaaraAction =
  | { type: "force_rotation"; reason: string }
  | { type: "cooldown_retry_probe"; providers: string[]; reason: string }
  | { type: "db_reconnect_probe"; reason: string }
  | { type: "prompt_degradation"; reason: string }
  | { type: "none"; reason: string };

export type HaaraAssessment = {
  level: HaaraLevel;
  reasons: string[];
  actions: HaaraAction[];
};

export type HaaraStatus = HaaraAssessment & {
  checkedAt: number;
  /** Heilaktionen, die der letzte Tick tatsächlich angewendet hat. */
  appliedActions: HaaraAction[];
};

/* ------------------------------------------------------------------ */
/* 1 · Reine Bewertung (ohne Netz, voll testbar)                      */
/* ------------------------------------------------------------------ */

/**
 * Stufenmaschine: sammelt Gründe je Stufe, leitet Heilaktionen ab.
 * Deterministisch, ohne Seiteneffekte.
 */
export function assessHaara(signal: HaaraSignal): HaaraAssessment {
  const reasons: string[] = [];
  const actions: HaaraAction[] = [];

  // --- Kritische Stufe -------------------------------------------------
  if (signal.database?.status === "fehler") {
    reasons.push("Datenbank meldet Fehler");
    actions.push({ type: "db_reconnect_probe", reason: "DB-Verbindung erneut probieren" });
  }
  if (signal.activeRoute === null) {
    reasons.push("Keine aktive LLM-Route");
    actions.push({ type: "force_rotation", reason: "Rotations-Tick erzwingen (Route-Wechsel)" });
    actions.push({
      type: "prompt_degradation",
      reason: "Auf kleinstes verfuegbares Modell degradieren",
    });
  }
  if (reasons.length > 0) {
    return { level: "critical", reasons, actions };
  }

  // --- Degraded-Stufe ---------------------------------------------------
  const recoverableCooldowns = signal.cooldowns.filter((c) => c.kind !== "auth");
  if (signal.cooldowns.length > 0) {
    reasons.push(
      `${signal.cooldowns.length} Anbieter im Cooldown (${signal.cooldowns
        .map((c) => `${c.provider}:${c.kind}`)
        .join(", ")})`,
    );
  }
  if (recoverableCooldowns.length > 0) {
    actions.push({
      type: "cooldown_retry_probe",
      providers: recoverableCooldowns.map((c) => c.provider),
      reason: "Limit-/Timeout-Cooldowns erneut probieren (Cooldown kann verflogen sein)",
    });
  }
  if (signal.database?.status === "nicht_konfiguriert") {
    reasons.push("Datenbank nicht konfiguriert (Free-Tier-Betrieb)");
  }

  if (reasons.length > 0) {
    // Heilaktionen vorhanden -> der Tick meldet sich anschliessend als
    // self_healing; ohne Heilaktion bleibt es bei degraded (wartend).
    return { level: actions.length > 0 ? "self_healing" : "degraded", reasons, actions };
  }

  return { level: "healthy", reasons: [], actions: [{ type: "none", reason: "Alle Systeme gruen" }] };
}

/* ------------------------------------------------------------------ */
/* 2 · Prompt-Routing (Task-Typ -> Modell-Tier)                       */
/* ------------------------------------------------------------------ */

export type PromptTaskClass = "classification" | "generation" | "coding";

/** Parst Modellgroessen-Suffixe ("qwen3.6:27b" -> 27). */
function modelSize(model: string): number {
  const match = /(\d+(?:\.\d+)?)b/i.exec(model);
  return match ? Number(match[1]) : 999;
}

function ollamaModels(): string[] {
  return (process.env.OLLAMA_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * Prompt-Routing: waehlt fuer eine Task-Klasse das passende Modell aus
 * OLLAMA_MODELS. Klassifikation/Tool-Antworten -> kleinstes Modell,
 * Generierung -> groesstes, Coding -> devstral bevorzugt, sonst mittleres.
 * Rueckgabe null, wenn keine Modelle konfiguriert sind (Aufrufer nutzt Default).
 */
export function routePromptModel(taskClass: PromptTaskClass): string | null {
  const models = ollamaModels().slice().sort((a, b) => modelSize(a) - modelSize(b));
  if (models.length === 0) return null;
  if (taskClass === "classification") return models[0];
  if (taskClass === "generation") return models[models.length - 1];
  const devstral = models.find((m) => /devstral/i.test(m));
  return devstral ?? models[Math.floor(models.length / 2)];
}

/* ------------------------------------------------------------------ */
/* 3 · Backpressure statt Auto-Scaling                                 */
/* ------------------------------------------------------------------ */

let inflight = 0;

export function haaraMaxConcurrency(): number {
  const parsed = Number(process.env.HAARA_MAX_CONCURRENCY ?? "8");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 8;
}

export type BackpressureInfo = {
  accepted: boolean;
  inflight: number;
  limit: number;
  retryAfterMs: number | null;
};

export function haaraBackpressure(now = Date.now()): BackpressureInfo {
  const limit = haaraMaxConcurrency();
  const accepted = inflight < limit;
  return {
    accepted,
    inflight,
    limit,
    retryAfterMs: accepted ? null : 250,
  };
}

export class HaaraBackpressureError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("Villa ausgelastet: Backpressure aktiv (HAARA)");
    this.name = "HaaraBackpressureError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Fuehrt fn nur aus, wenn Concurrency frei ist; sonst sofortiger Fehler. */
export async function withHaaraBackpressure<T>(fn: () => Promise<T>): Promise<T> {
  const info = haaraBackpressure();
  if (!info.accepted) throw new HaaraBackpressureError(info.retryAfterMs ?? 250);
  inflight += 1;
  try {
    return await fn();
  } finally {
    inflight = Math.max(0, inflight - 1);
  }
}

/* ------------------------------------------------------------------ */
/* 4 · Orchestrator (Tick)                                             */
/* ------------------------------------------------------------------ */

let lastStatus: HaaraStatus | null = null;
/** Verlauf der letzten Bewertungen (Ringpuffer) fuer Diagnose/Dashboard. */
const history: HaaraStatus[] = [];
const HAARA_HISTORY_MAX = 50;

export interface HaaraTickOptions {
  now?: () => number;
  /** Tests: Netzproben (Rotation/DB) ueberspringen. */
  offline?: boolean;
  /** Rotation-Tick selbst anstossen (Standard: nur lesen, Rotator hat 5-min-Rhythmus). */
  forceRotation?: boolean;
}

/**
 * Ein HAARA-Schritt: Signale sammeln, bewerten, Heilaktionen anwenden.
 * Netzwerkfehler stoeren den Betrieb nie — dann wird mit dem letzten
 * bekannten Stand bewertet.
 */
export async function haaraTick(options: HaaraTickOptions = {}): Promise<HaaraStatus> {
  const now = (options.now ?? Date.now)();
  let rotation: RotationStatus | null = null;
  try {
    rotation = getRotationStatus();
  } catch {
    rotation = null;
  }

  let database: Pick<DatabaseHealthReport, "status"> | null = null;
  if (!options.offline) {
    try {
      const report = await checkDatabaseHealth();
      database = { status: report.status };
    } catch {
      database = { status: "fehler" };
    }
  }

  let cooldowns: HaaraSignal["cooldowns"] = [];
  try {
    cooldowns = providerCooldownSnapshot(now);
  } catch {
    cooldowns = [];
  }

  const signal: HaaraSignal = {
    // Sprint 103 — Fix: aktive Route zustandslos aus Konfiguration
    // (gleiche Quelle wie /api/health), NICHT aus dem probe-basierten
    // Rotator-State, der beim Kaltstart noch leer ist.
    activeRoute: activeRouteFromConfig(),
    rotation: rotation ? { rankedRoutes: rotation.rankedRoutes, routes: rotation.routes } : null,
    cooldowns,
    database,
    now,
  };

  const assessment = assessHaara(signal);
  const applied: HaaraAction[] = [];

  if (!options.offline) {
    for (const action of assessment.actions) {
      try {
        if (action.type === "force_rotation") {
          // Keine aktive Route: Rotations-Tick erzwingen (Route-Wechsel).
          await runRotationTick({ now: options.now });
          applied.push(action);
        } else if (action.type === "cooldown_retry_probe") {
          // Cooldown-Probe: ein Rotations-Tick probiert alle Routen neu
          // und raeumt verflogene Cooldowns ueber die Health-Probe ab.
          await runRotationTick({ now: options.now });
          applied.push(action);
        } else if (action.type === "db_reconnect_probe") {
          const report = await checkDatabaseHealth();
          if (report.status === "verbunden") {
            applied.push({ ...action, reason: "DB-Reconnect erfolgreich" });
          }
        }
        // prompt_degradation wirkt ueber routePromptModel() im Aufrufer;
        // hier gibt es nichts weiter anzuwenden.
      } catch {
        /* Heilaktion gescheitert -> naechster Tick versucht es erneut */
      }
    }
    if (options.forceRotation) {
      // Admin/Test: Rotation unabhaengig von der Bewertung anstossen.
      await runRotationTick({ now: options.now }).catch(() => undefined);
    }
  }

  const status: HaaraStatus = {
    ...assessment,
    checkedAt: now,
    appliedActions: applied,
  };
  lastStatus = status;
  history.push(status);
  if (history.length > HAARA_HISTORY_MAX) history.shift();
  return status;
}

/** Letzter bekannter HAARA-Status (null vor dem ersten Tick). */
export function getHaaraStatus(): HaaraStatus | null {
  return lastStatus;
}

/** Verlauf (aelteste zuerst) fuer Diagnose. */
export function haaraHistory(): readonly HaaraStatus[] {
  return history;
}

/** Nur fuer Tests: Zustand vollstaendig zuruecksetzen. */
export function resetHaaraForTests(): void {
  lastStatus = null;
  history.length = 0;
  inflight = 0;
}

