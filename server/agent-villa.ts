import type { Provider } from "./agent-engine";

/**
 * A villa is a logical workspace. Its agents are provisioned lazily; this
 * avoids creating 5,000 outbound model requests or paying for idle capacity.
 */
export const LOGICAL_AGENTS_PER_VILLA = 5_000 as const;
export const DEFAULT_VILLA_ID = "villa-main" as const;

export type PackKind =
  | "feature"
  | "tool"
  | "developer"
  | "system"
  | "skill"
  | "connector";

export type CapabilityPack = {
  id: string;
  name: string;
  kind: PackKind;
  description: string;
  enabledByDefault: boolean;
  administratorOnly?: boolean;
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
    id: "elite-project-factory",
    name: "Elite Projektfabrik",
    kind: "feature",
    description:
      "Administrator-Missionsmodus: Idee analysieren, Repository untersuchen, Implementierung planen, Dateien ändern, Tests ergänzen und einen Draft-PR als fertiges Arbeitsergebnis vorbereiten.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "multi-agent-delegation",
    name: "Multi-Agent Delegation",
    kind: "feature",
    description:
      "Teilt große Aufgaben logisch in Architektur, Entwicklung, Tests, Review und Dokumentation auf, ohne unnötige parallele Modellaufrufe zu erzeugen.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "safe-provider-router",
    name: "Sicherer Provider-Router",
    kind: "feature",
    description:
      "Erlaubnisbasierte Auswahl konfigurierter Anbieter mit Free-Tier-Kette, Cache und Deduplizierung ohne Quoten- oder Kostenumgehung.",
    enabledByDefault: true,
  },
  {
    id: "provider-guardian",
    name: "Provider-Wächter (Free-Route Health)",
    kind: "system",
    description:
      "Autonomer Administrator-Agent, der die kostenlosen Modellrouten fortlaufend prüft, tote oder limitierte Routen in einen Cooldown setzt und automatisch die funktionsfähige kostenlose Route aktiv hält.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "project-workshop",
    name: "Projekt-Werkstatt",
    kind: "feature",
    description:
      "Planung, Prüfung und nachvollziehbare Entwicklungsworkflows.",
    enabledByDefault: true,
  },
  {
    id: "idea-to-product",
    name: "Idee-zu-Produkt",
    kind: "skill",
    description:
      "Übersetzt eine Produktidee in Scope, Architektur, Meilensteine, Implementierung, Qualitätssicherung und auslieferbares Repository-Ergebnis.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "software-architecture",
    name: "Software-Architektur",
    kind: "skill",
    description:
      "Analysiert vorhandene Strukturen und entwirft kompatible Module, Datenflüsse, APIs und Migrationsschritte.",
    enabledByDefault: true,
  },
  {
    id: "implementation",
    name: "Implementierung & Refactoring",
    kind: "developer",
    description:
      "Erstellt und überarbeitet produktionsnahen Code innerhalb des verbundenen Projekts.",
    enabledByDefault: true,
  },
  {
    id: "code-analysis",
    name: "Code-Analyse",
    kind: "developer",
    description:
      "Typprüfung, Architektur-, Abhängigkeits- und Änderungsanalyse.",
    enabledByDefault: true,
  },
  {
    id: "test-generation",
    name: "Test-Erstellung",
    kind: "developer",
    description:
      "Erzeugung und Prüfung von Unit-, Integrations- und Regressionstests.",
    enabledByDefault: true,
  },
  {
    id: "security-review",
    name: "Security Review",
    kind: "developer",
    description:
      "Prüft Eingaben, Berechtigungen, Secret-Grenzen und gefährliche Repository-Änderungen vor der Übergabe.",
    enabledByDefault: true,
  },
  {
    id: "documentation",
    name: "Dokumentation",
    kind: "skill",
    description:
      "Erstellt technische Dokumentation, Setup-Hinweise, Änderungszusammenfassungen und PR-Beschreibungen.",
    enabledByDefault: true,
  },
  {
    id: "acceptance-criteria",
    name: "Akzeptanzkriterien & Definition of Done",
    kind: "skill",
    description:
      "Leitet aus einer Idee prüfbare Akzeptanzkriterien und eine Definition of Done ab, damit eine Mission ein überprüfbares Ergebnis statt eines bloßen Plans liefert.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "regression-guard",
    name: "Regressionsschutz",
    kind: "developer",
    description:
      "Hält bestehende Tests grün, ergänzt bei Verhaltenänderungen gezielte Regressionstests und verhindert stille Brüche in bereits funktionierenden Bereichen.",
    enabledByDefault: true,
  },
  {
    id: "dependency-hygiene",
    name: "Abhängigkeits-Hygiene",
    kind: "developer",
    description:
      "Prüft Abhängigkeiten und Lockfile-Konsistenz, vermeidet unnötige neue Pakete und bevorzugt bestehende, kostenlose Standardbibliotheken.",
    enabledByDefault: true,
  },
  {
    id: "build-verify",
    name: "Build- & Test-Verifikation",
    kind: "tool",
    description:
      "Führt Typecheck, Tests und Build über die vorhandenen Projekt-Skripte aus und berichtet echte Ergebnisse statt behaupteter Erfolge.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "change-review",
    name: "Änderungs-Review",
    kind: "developer",
    description:
      "Liest die eigenen Änderungen erneut, prüft Konsistenz, Sicherheitsgrenzen und Vollständigkeit gegenüber den Akzeptanzkriterien.",
    enabledByDefault: true,
  },
  {
    id: "handoff-summary",
    name: "Übergabe-Zusammenfassung",
    kind: "tool",
    description:
      "Erzeugt eine prüfbare Übergabe mit geänderten Dateien, Teststand, offenen Punkten und Draft-PR-Verweis.",
    enabledByDefault: true,
  },
  {
    id: "github-read",
    name: "GitHub Lesen",
    kind: "tool",
    description:
      "Repository-Überblick, Dateien, Baum, Commits, Issues, Pull Requests und Check-Runs lesen.",
    enabledByDefault: true,
  },
  {
    id: "github-draft-writes",
    name: "GitHub Draft-Änderungen",
    kind: "tool",
    description:
      "Schreibvorgänge nur auf neu erstellten agent/*-Branches; fertige Arbeit wird als Draft-PR zur Prüfung geöffnet.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "ci-observer",
    name: "CI Beobachter",
    kind: "tool",
    description:
      "Liest vorhandene GitHub Check-Runs, damit der Superagent Build- und Testergebnisse in seine Bewertung einbeziehen kann.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "openrouter-free",
    name: "OpenRouter Free Router",
    kind: "connector",
    description:
      "Primäre kostenlose Modellroute über konfigurierte OpenRouter-Free-Modelle.",
    enabledByDefault: true,
  },
  {
    id: "huggingface-fallback",
    name: "Hugging Face Fallback",
    kind: "connector",
    description:
      "Optionaler kostenloser Fallback bei vorübergehendem Ausfall, nur wenn ausdrücklich aktiviert und konfiguriert.",
    enabledByDefault: true,
  },
  {
    id: "github-connector",
    name: "GitHub Connector",
    kind: "connector",
    description:
      "Geschützter Repository-Zugriff über serverseitigen Token mit Branch- und Draft-PR-Sicherheitsgrenzen.",
    enabledByDefault: true,
    administratorOnly: true,
  },
  {
    id: "postgres-memory",
    name: "PostgreSQL Villa Memory",
    kind: "connector",
    description:
      "Persistente Villen, Nachrichten und Bewertungen über PostgreSQL/Neon.",
    enabledByDefault: true,
  },
  {
    id: "audit-trail",
    name: "Audit-Protokoll",
    kind: "system",
    description:
      "Nachvollziehbare Entscheidungen, sichere Fehlerbehandlung und klar erkennbare externe Grenzen.",
    enabledByDefault: true,
  },
] as const;

export const ELITE_PLAN = {
  id: "elite",
  name: "Administrator Elite",
  enabled: true,
  administratorOnly: true,
  localTurnQuota: null,
  localTokenQuota: null,
  autonomousProjectMissions: true,
  multiAgentDelegation: true,
  freeTierFirst: true,
  protectedRepositoryWrites: true,
  externalProviderQuotasStillApply: true,
} as const;

/**
 * Admin-Projektion des Elite-Pakets. "Unlimited" bedeutet ausschliesslich:
 * kein lokales Chat-/Token-Gesamtkontingent in der Villa und automatische
 * Free-Route-Pflege. Technische Kontext-/Ausgabelimits und Kontingente
 * externer Anbieter gelten unveraendert und werden nie umgangen.
 */
export function getEliteUnlimitedProjection() {
  return {
    plan: ELITE_PLAN.name,
    localChatQuota: "unlimited" as const,
    localTokenQuota: "unlimited" as const,
    externalProviderQuotasApply: true as const,
    technicalModelLimitsApply: true as const,
    guardianMaintainsFreeRoutes: true as const,
    tokenCreation: "provider-defined" as const,
    note: "Unbegrenzt bezieht sich nur auf das lokale Villa-Kontingent. Der Waechter erzeugt keine Token und umgeht keine Anbieterkontingente.",
  };
}

export function getEliteConnectorSnapshot() {
  return [
    {
      id: "openrouter",
      name: "OpenRouter Free",
      kind: "model",
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      mode: "free-first",
    },
    {
      id: "huggingface",
      name: "Hugging Face",
      kind: "model",
      configured: Boolean(process.env.HF_TOKEN?.trim()),
      mode: "explicit-fallback",
    },
    {
      id: "github",
      name: "GitHub",
      kind: "repository",
      configured: Boolean(process.env.GITHUB_TOKEN?.trim()),
      mode: "agent-branch-draft-pr",
    },
    {
      id: "postgres",
      name: "PostgreSQL / Neon",
      kind: "memory",
      configured: Boolean(process.env.DATABASE_URL?.trim()),
      mode: "persistent",
    },
    {
      id: "google-oauth",
      name: "Google OAuth",
      kind: "identity",
      configured: Boolean(
        process.env.GOOGLE_CLIENT_ID?.trim() &&
          process.env.GOOGLE_CLIENT_SECRET?.trim()
      ),
      mode: "login",
    },
  ] as const;
}

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
    edition: ELITE_PLAN.name,
    logicalAgentCapacity: LOGICAL_AGENTS_PER_VILLA,
    provisioning: "lazy" as const,
    activeLogicalAgents: 0,
    availableLogicalAgents: LOGICAL_AGENTS_PER_VILLA,
    elite: ELITE_PLAN,
    autonomy: {
      ideaToProject: true,
      repositoryInspection: true,
      architectureAndPlanning: true,
      implementation: true,
      testAuthoring: true,
      documentation: true,
      draftPullRequestDelivery: true,
      ciObservation: true,
      autonomousFreeRouteGuardian: true,
    },
    packs: CAPABILITY_PACKS.map(
      ({ id, name, kind, description, administratorOnly }) => ({
        id,
        name,
        kind,
        description,
        administratorOnly: Boolean(administratorOnly),
        enabled: true,
      })
    ),
    connectors: getEliteConnectorSnapshot(),
    policy: {
      providerLimitsRespected: true,
      noPaidOrRotatingFallback: true,
      administratorFullProductAccess: true,
      administratorLocalTurnQuota: null,
      administratorLocalTokenQuota: null,
      externalToolWritesRequireExistingSafetyGuards: true,
      defaultBranchProtectedFromAgentWrites: true,
      draftReviewBeforeMerge: true,
    },
  };
}

export function getVillaSystemContext(villaId: string = DEFAULT_VILLA_ID) {
  const snapshot = getVillaSnapshot(villaId);
  return `Villa ${snapshot.id} läuft im Administrator-Elite-Modus und verwaltet bis zu ${snapshot.logicalAgentCapacity} logisch provisionierte Agentenplätze. Die App setzt für Administratoren kein lokales Chat- oder Token-Gesamtkontingent; technische Kontext-/Ausgabelimits sowie Kontingente externer Modellanbieter gelten weiterhin. Agenten werden nur bei Bedarf gestartet. Aktivierte Packs: ${snapshot.packs.map(pack => pack.id).join(", ")}. GitHub-Schreibzugriffe bleiben auf agent/*-Branches und Draft-PRs begrenzt; Secrets, Workflows, Berechtigungen und der Default-Branch werden nicht autonom verändert.`;
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
  "Administrator Elite ist aktiv: keine lokalen Chat- oder Token-Gesamtkontingente, autonome Idee-zu-Projekt-Missionen und Free-Tier-First-Routing. Technische Modellgrenzen, externe Provider-Kontingente, GitHub-Berechtigungen und Sicherheitsregeln gelten weiterhin.";
