export const AGENT_ERROR_CODES = [
  "MISSING_KEY",
  "LIMIT",
  "AUTH",
  "UNAVAILABLE",
  "REJECTED",
  // Sprint 074 — getrennt von REJECTED: die Anfrage überschreitet nur das
  // Kontextfenster dieses Modells (kein Inhaltsverstoß). Anders als eine
  // inhaltliche Ablehnung darf hierfür ein anderes Modell/Anbieter mit
  // größerem Kontext versucht werden.
  "CONTEXT_TOO_LARGE",
  "STOPPED",
  "INVALID_RESPONSE",
  "INVALID_INPUT",
  "TIMEOUT",
  // Sprint 079 — Admin-Pin auf einen aktuell nicht nutzbaren Anbieter.
  "PIN_UNAVAILABLE",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];
export type ErrorCategory =
  | "configuration"
  | "quota"
  | "authorization"
  | "provider"
  | "capacity"
  | "control"
  | "validation";

export const ERROR_CATEGORIES: Record<AgentErrorCode, ErrorCategory> = {
  MISSING_KEY: "configuration",
  LIMIT: "quota",
  AUTH: "authorization",
  UNAVAILABLE: "provider",
  REJECTED: "provider",
  CONTEXT_TOO_LARGE: "capacity",
  STOPPED: "control",
  INVALID_RESPONSE: "validation",
  INVALID_INPUT: "validation",
  TIMEOUT: "provider",
  PIN_UNAVAILABLE: "configuration",
};

export const PUBLIC_ERROR_MESSAGES: Record<ErrorCategory, string> = {
  configuration: "Die benötigte Konfiguration ist noch nicht eingerichtet.",
  quota: "Das verfügbare Kontingent wurde erreicht.",
  authorization: "Die Anfrage ist nicht autorisiert.",
  provider: "Der Anbieter konnte die Anfrage gerade nicht verarbeiten.",
  capacity: "Die Anfrage überschreitet das Kontextfenster des Modells.",
  control: "Der Agent ist aktuell gestoppt.",
  validation: "Die Antwort konnte nicht sicher validiert werden.",
};

export function categoryForError(code: AgentErrorCode) {
  return ERROR_CATEGORIES[code];
}

export function publicMessageForError(code: AgentErrorCode) {
  return PUBLIC_ERROR_MESSAGES[categoryForError(code)];
}
