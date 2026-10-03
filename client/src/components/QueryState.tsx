import type { ReactNode } from "react";
import { flowErrorMessage, flowPhase } from "@/lib/queryFlow";

/**
 * Sprint 069 — Fehler- und Ladezustände (Roadmap 068).
 *
 * Wrapper für datengetriebene Bereiche: Kein Flow endet in einer leeren
 * oder blockierten Ansicht. Erstladen zeigt einen sichtbaren Ladehinweis,
 * Fehler zeigen eine lesbare Fehlerkarte mit „Erneut laden“, alles andere
 * rendert die Kinder. Deaktivierte Abfragen (vor der Anmeldung) sind
 * bewusst „ready“ und verursachen keinen Spinner.
 */
export interface QueryStateProps {
  /** Bezeichnung im Satz: „Villen werden geladen …“ / „Villen konnten nicht geladen werden“ (Plural). */
  label: string;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error?: unknown;
  enabled?: boolean;
  onRetry: () => void;
  children: ReactNode;
}

export function QueryState({
  label,
  isPending,
  isFetching,
  isError,
  error,
  enabled,
  onRetry,
  children,
}: QueryStateProps) {
  const phase = flowPhase({ enabled, isPending, isFetching, isError });

  if (phase === "loading") {
    return (
      <div className="query-state" data-phase="loading" role="status">
        <span className="ready-pulse" />
        {label} werden geladen …
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="query-state" data-phase="error" role="alert">
        <p>
          {label} konnten nicht geladen werden: {flowErrorMessage(error)}
        </p>
        <button type="button" className="message-retry" onClick={onRetry}>
          Erneut laden
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
