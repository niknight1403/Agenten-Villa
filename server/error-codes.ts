export const AGENT_ERROR_CODES = [
  "MISSING_KEY",
  "LIMIT",
  "AUTH",
  "UNAVAILABLE",
  "REJECTED",
  "STOPPED",
  "INVALID_RESPONSE",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];
export type ErrorCategory =
  | "configuration"
  | "quota"
  | "authorization"
  | "provider"
  | "control"
  | "validation";

export const ERROR_CATEGORIES: Record<AgentErrorCode, ErrorCategory> = {
  MISSING_KEY: "configuration",
  LIMIT: "quota",
  AUTH: "authorization",
  UNAVAILABLE: "provider",
  REJECTED: "provider",
  STOPPED: "control",
  INVALID_RESPONSE: "validation",
};

export const PUBLIC_ERROR_MESSAGES: Record<ErrorCategory, string> = {
  configuration: "Die benötigte Konfiguration ist noch nicht eingerichtet.",
  quota: "Das verfügbare Kontingent wurde erreicht.",
  authorization: "Die Anfrage ist nicht autorisiert.",
  provider: "Der Anbieter konnte die Anfrage gerade nicht verarbeiten.",
  control: "Der Agent ist aktuell gestoppt.",
  validation: "Die Antwort konnte nicht sicher validiert werden.",
};

export function categoryForError(code: AgentErrorCode) {
  return ERROR_CATEGORIES[code];
}

export function publicMessageForError(code: AgentErrorCode) {
  return PUBLIC_ERROR_MESSAGES[categoryForError(code)];
}
