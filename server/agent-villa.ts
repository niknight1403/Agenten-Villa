import type { Provider } from "./agent-engine";

/**
 * A villa is a logical workspace. Its agents are provisioned lazily; this
 * avoids creating 5,000 outbound model requests or paying for idle capacity.
 */
export const LOGICAL_AGENTS_PER_VILLA = 5_000 as const;
export const DEFAULT_VILLA_ID = "villa-main" as const;

export type PackKind = "feature" | "tool" | "developer" | "system";
export type CapabilityPack = {
  id: string;
  name: string;
  kind: PackKind;
  description: string;
  enabledByDefault: boolean;
};

export const CAPABILITY_PACKS: readonly CapabilityPack[] = [
  {
    id: "agent-orchestration",
    name: "Agenten-Orchestrierung",
    kind: "feature",
    description:
      "Lazy-Provisionierung, Rollen und Arbeitszyklen für logische Agentenplätze.",
    enabledByDefault: true,
  },
  {
    id: "safe-provider-router",
    name: "Sicherer Provider-Router",
    kind: "feature",
    description:
      "Erlaubnisbasierte Auswahl konfigurierter Anbieter ohne Limit- oder Kostenumgehung.",
    enabledByDefault: true,
  },
  {
    id: "project-workshop",
    name: "Projekt-Werkstatt",
    kind: "feature",
    description: "Planung, Prüfung und nachvollziehbare Entwicklungsworkflows.",
    enabledByDefault: true,
  },
  {
    id: "github-read",
    name: "GitHub Lesen",
    kind: "tool",
    description: "Lesender Zugriff auf das verbundene Repository.",
    enabledByDefault: true,
  },
  {
    id: "github-draft-writes",
    name: "GitHub Draft-Änderungen",
    kind: "tool",
    description:
      "Schreibvorgänge nur auf neu erstellten agent/*-Branches und als Draft-PR.",
    enabledByDefault: true,
  },
  {
    id: "code-analysis",
    name: "Code-Analyse",
    kind: "developer",
    description: "Typprüfung, Tests, Architektur- und Änderungsanalyse.",
    enabledByDefault: true,
  },
  {
    id: "test-generation",
    name: "Test-Erstellung",
    kind: "developer",
    description: "Erzeugung und Prüfung von Unit- und Regressionstests.",
    enabledByDefault: true,
  },
  {
    id: "audit-trail",
    name: "Audit-Protokoll",
    kind: "system",
    description:
      "Nachvollziehbare Entscheidungen und sichere Fehlerbehandlung.",
    enabledByDefault: true,
  },
] as const;

export type ProviderRoute = {
  provider: Provider;
  model: string;
  reason: "primary-free" | "explicit-fallback";
};

/**
 * Provider routing is deliberately fail-closed: HTTP 429/402 must stop the
 * request. This function only chooses among configured, permitted routes and
 * never rotates keys, impersonates users, or bypasses provider quotas.
 */
export function routeProvider(options: {
  openRouterConfigured: boolean;
  huggingFaceConfigured: boolean;
  allowExplicitFallback: boolean;
}): ProviderRoute | null {
  if (options.openRouterConfigured)
    return {
      provider: "openrouter",
      model: "openrouter/free",
      reason: "primary-free",
    };
  if (options.allowExplicitFallback && options.huggingFaceConfigured) {
    return {
      provider: "huggingface",
      model: "google/gemma-2-2b-it",
      reason: "explicit-fallback",
    };
  }
  return null;
}

export function getVillaSnapshot(villaId: string = DEFAULT_VILLA_ID) {
  return {
    id: villaId,
    logicalAgentCapacity: LOGICAL_AGENTS_PER_VILLA,
    provisioning: "lazy" as const,
    activeLogicalAgents: 0,
    availableLogicalAgents: LOGICAL_AGENTS_PER_VILLA,
    packs: CAPABILITY_PACKS.map(({ id, name, kind, description }) => ({
      id,
      name,
      kind,
      description,
      enabled: true,
    })),
    policy: {
      providerLimitsRespected: true,
      noPaidOrRotatingFallback: true,
      administratorFullProductAccess: true,
      externalToolWritesRequireExistingSafetyGuards: true,
    },
  };
}

export function getVillaSystemContext(villaId: string = DEFAULT_VILLA_ID) {
  const snapshot = getVillaSnapshot(villaId);
  return `Villa ${snapshot.id} verwaltet bis zu ${snapshot.logicalAgentCapacity} logisch provisionierte Agentenplätze. Agenten werden bei Bedarf gestartet, nicht vorab als kostenpflichtige Modellaufrufe erzeugt. Aktivierte Packs: ${snapshot.packs.map(pack => pack.id).join(", ")}. Anbieterlimits, Nutzungsbedingungen und Sicherheitsregeln werden niemals umgangen.`;
}

export function isKnownPack(packId: string) {
  return CAPABILITY_PACKS.some(pack => pack.id === packId);
}

export function resetVillaStateForTests() {
  // Kept as a stable test hook for future persistent provisioning state.
}

type ProviderRouterInput = Parameters<typeof routeProvider>[0];
export function routeProviderForTests(input: ProviderRouterInput) {
  return routeProvider(input);
}

export const VILLA_NOTICE =
  "Die Villa stellt 5.000 logische Agentenplätze pro Superagent bereit und provisioniert sie bedarfsgesteuert. Anbieterlimits werden eingehalten; es gibt keine Limit-, Kosten- oder Zugangsumgehung.";
