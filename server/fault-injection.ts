import { AgentError } from "./error-codes";
import {
  AGENT_ERROR_CODES,
  type AgentErrorCode,
  categoryForError,
  publicMessageForError,
  type ErrorCategory,
} from "./error-codes";
import type { ExecutableDatabase } from "./db-health";

/**
 * Sprint 086 — Fehler-Injection Harness & Fehlerklassen.
 *
 * Simuliert deterministische Timeout-, Rate-Limit- und Persistenzfehler
 * für Router-, Engine- und Datenbank-Fehlerpfade unter Wiederverwendung
 * der Sprint-008-Fehlerklassen.
 */

// Custom error for persistence / DB layer failures
export class PersistenceError extends Error {
  constructor(
    public readonly code:
      | "DATABASE_UNAVAILABLE"
      | "PERSISTENCE_READ_FAILED"
      | "PERSISTENCE_WRITE_FAILED"
      | "TRANSACTION_ABORTED"
      | "LOCK_TIMEOUT"
      | string,
    message: string
  ) {
    super(message);
    this.name = "PersistenceError";
  }
}

// Specific Provider Error Classes inheriting from AgentError (Sprint 008 codes)
export class ProviderTimeoutError extends AgentError {
  constructor(message = "Anbieter-Zeitüberschreitung (Timeout)", retryAfterSeconds?: number) {
    super("TIMEOUT", message, 504, retryAfterSeconds);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderRateLimitError extends AgentError {
  constructor(message = "Anbieter-Rate-Limit überschritten", retryAfterSeconds = 60) {
    super("LIMIT", message, 429, retryAfterSeconds);
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderAuthError extends AgentError {
  constructor(message = "Anbieter-Authentifizierung fehlgeschlagen") {
    super("AUTH", message, 401);
    this.name = "ProviderAuthError";
  }
}

export class ProviderUnavailableError extends AgentError {
  constructor(message = "Anbieter vorübergehend nicht erreichbar") {
    super("UNAVAILABLE", message, 503);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderRejectedError extends AgentError {
  constructor(message = "Anfrage vom Anbieter abgelehnt") {
    super("REJECTED", message, 400);
    this.name = "ProviderRejectedError";
  }
}

export class ProviderContextTooLargeError extends AgentError {
  constructor(message = "Kontextfenster des Modells überschritten") {
    super("CONTEXT_TOO_LARGE", message, 400);
    this.name = "ProviderContextTooLargeError";
  }
}

export class ProviderStoppedError extends AgentError {
  constructor(message = "Agentenlauf wurde gestoppt") {
    super("STOPPED", message, 400);
    this.name = "ProviderStoppedError";
  }
}

export class ProviderInvalidResponseError extends AgentError {
  constructor(message = "Ungültige Antwort vom Anbieter empfangen") {
    super("INVALID_RESPONSE", message, 502);
    this.name = "ProviderInvalidResponseError";
  }
}

export class ProviderInvalidInputError extends AgentError {
  constructor(message = "Ungültige Eingabe für Agentenlauf") {
    super("INVALID_INPUT", message, 400);
    this.name = "ProviderInvalidInputError";
  }
}

export class ProviderMissingKeyError extends AgentError {
  constructor(message = "Erforderlicher API-Schlüssel fehlt") {
    super("MISSING_KEY", message, 400);
    this.name = "ProviderMissingKeyError";
  }
}

export class ProviderPinUnavailableError extends AgentError {
  constructor(message = "Gepinnter Anbieter nicht verfügbar") {
    super("PIN_UNAVAILABLE", message, 503);
    this.name = "ProviderPinUnavailableError";
  }
}

export type FaultTarget = "provider" | "database" | "router" | "custom";

export interface FaultRule {
  target: FaultTarget;
  code: AgentErrorCode | string;
  message?: string;
  delayMs?: number;
  retryAfterSeconds?: number;
  status?: number;
  probability?: number;
  maxTriggers?: number;
}

export interface InjectedFaultStats {
  totalInjected: number;
  byTarget: Record<FaultTarget, number>;
  byCode: Record<string, number>;
}

class FaultInjectionRegistry {
  private rules: FaultRule[] = [];
  private triggerCounts: Map<FaultRule, number> = new Map();
  private stats: InjectedFaultStats = {
    totalInjected: 0,
    byTarget: { provider: 0, database: 0, router: 0, custom: 0 },
    byCode: {},
  };

  public setRules(rules: FaultRule | FaultRule[]): void {
    this.rules = Array.isArray(rules) ? [...rules] : [rules];
    this.triggerCounts.clear();
  }

  public addRule(rule: FaultRule): void {
    this.rules.push(rule);
  }

  public clear(): void {
    this.rules = [];
    this.triggerCounts.clear();
  }

  public resetStats(): void {
    this.stats = {
      totalInjected: 0,
      byTarget: { provider: 0, database: 0, router: 0, custom: 0 },
      byCode: {},
    };
  }

  public getStats(): InjectedFaultStats {
    return { ...this.stats, byTarget: { ...this.stats.byTarget }, byCode: { ...this.stats.byCode } };
  }

  public getRules(): readonly FaultRule[] {
    return [...this.rules];
  }

  public isActive(): boolean {
    return this.rules.length > 0;
  }

  private recordFault(target: FaultTarget, code: string): void {
    this.stats.totalInjected++;
    this.stats.byTarget[target] = (this.stats.byTarget[target] ?? 0) + 1;
    this.stats.byCode[code] = (this.stats.byCode[code] ?? 0) + 1;
  }

  public async evaluateFault(target: FaultTarget, defaultCode?: string): Promise<never | void> {
    const matchingRule = this.rules.find((r) => {
      if (r.target !== target) return false;
      if (r.maxTriggers !== undefined) {
        const count = this.triggerCounts.get(r) ?? 0;
        if (count >= r.maxTriggers) return false;
      }
      if (r.probability !== undefined && Math.random() > r.probability) {
        return false;
      }
      return true;
    });

    if (!matchingRule) return;

    // Increment trigger count
    const currentCount = this.triggerCounts.get(matchingRule) ?? 0;
    this.triggerCounts.set(matchingRule, currentCount + 1);

    // Apply delay if configured
    if (matchingRule.delayMs && matchingRule.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, matchingRule.delayMs));
    }

    const code = matchingRule.code || defaultCode || "UNKNOWN_FAULT";
    this.recordFault(target, code);

    const message = matchingRule.message || `Injected ${target} fault: ${code}`;

    if (target === "database") {
      throw new PersistenceError(code, message);
    }

    // Provider / Router faults map to AgentError or specialized error subclasses
    switch (code) {
      case "TIMEOUT":
        throw new ProviderTimeoutError(message, matchingRule.retryAfterSeconds);
      case "LIMIT":
        throw new ProviderRateLimitError(message, matchingRule.retryAfterSeconds ?? 60);
      case "AUTH":
        throw new ProviderAuthError(message);
      case "UNAVAILABLE":
        throw new ProviderUnavailableError(message);
      case "REJECTED":
        throw new ProviderRejectedError(message);
      case "CONTEXT_TOO_LARGE":
        throw new ProviderContextTooLargeError(message);
      case "STOPPED":
        throw new ProviderStoppedError(message);
      case "INVALID_RESPONSE":
        throw new ProviderInvalidResponseError(message);
      case "INVALID_INPUT":
        throw new ProviderInvalidInputError(message);
      case "MISSING_KEY":
        throw new ProviderMissingKeyError(message);
      case "PIN_UNAVAILABLE":
        throw new ProviderPinUnavailableError(message);
      default:
        throw new AgentError(
          code as AgentErrorCode,
          message,
          matchingRule.status ?? 500,
          matchingRule.retryAfterSeconds
        );
    }
  }
}

export const faultRegistry = new FaultInjectionRegistry();

/**
 * Scoped async helper to execute a function with active fault injection rules,
 * restoring prior rules afterward.
 */
export async function withFaults<T>(
  rules: FaultRule | FaultRule[],
  fn: () => Promise<T>
): Promise<T> {
  const previousRules = faultRegistry.getRules();
  try {
    faultRegistry.setRules(rules);
    return await fn();
  } finally {
    faultRegistry.setRules([...previousRules]);
  }
}

/**
 * Creates a mock LLM/provider function that simulates faults before executing response logic.
 */
export function createFaultInjectedProvider(
  handler: (prompt: string) => Promise<string> = async () => "Simulierter Erfolg"
) {
  return async (prompt: string): Promise<string> => {
    await faultRegistry.evaluateFault("provider");
    return handler(prompt);
  };
}

/**
 * Creates a mock ExecutableDatabase that simulates persistence faults on execute().
 */
export function createFaultInjectedDatabase(
  realExecute: (sql: string) => Promise<unknown> = async () => [{ ok: 1 }]
): ExecutableDatabase {
  return {
    async execute(sql: string): Promise<unknown> {
      await faultRegistry.evaluateFault("database", "DATABASE_UNAVAILABLE");
      return realExecute(sql);
    },
  };
}

/**
 * Helper to construct an AgentError for any given AgentErrorCode from Sprint 008.
 */
export function buildInjectedError(
  code: AgentErrorCode,
  customMessage?: string,
  retryAfterSeconds?: number
): AgentError {
  const msg = customMessage || publicMessageForError(code) || `Injected error ${code}`;
  switch (code) {
    case "TIMEOUT":
      return new ProviderTimeoutError(msg, retryAfterSeconds);
    case "LIMIT":
      return new ProviderRateLimitError(msg, retryAfterSeconds ?? 60);
    case "AUTH":
      return new ProviderAuthError(msg);
    case "UNAVAILABLE":
      return new ProviderUnavailableError(msg);
    case "REJECTED":
      return new ProviderRejectedError(msg);
    case "CONTEXT_TOO_LARGE":
      return new ProviderContextTooLargeError(msg);
    case "STOPPED":
      return new ProviderStoppedError(msg);
    case "INVALID_RESPONSE":
      return new ProviderInvalidResponseError(msg);
    case "INVALID_INPUT":
      return new ProviderInvalidInputError(msg);
    case "MISSING_KEY":
      return new ProviderMissingKeyError(msg);
    case "PIN_UNAVAILABLE":
      return new ProviderPinUnavailableError(msg);
    default:
      return new AgentError(code, msg, 500, retryAfterSeconds);
  }
}
