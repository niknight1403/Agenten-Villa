export const LOGICAL_AGENT_CAPACITY = 1_000 as const;

const domains = [
  "planning",
  "product",
  "architecture",
  "frontend",
  "backend",
  "database",
  "api",
  "mobile",
  "testing",
  "security",
  "devops",
  "performance",
  "accessibility",
  "documentation",
  "github",
  "analytics",
  "research",
  "quality",
  "operations",
  "integration",
] as const;

const competencies = [
  "analysis",
  "requirements",
  "design",
  "implementation",
  "refactoring",
  "review",
  "security",
  "testing",
  "documentation",
  "optimization",
] as const;

const phases = [
  "discovery",
  "planning",
  "execution",
  "validation",
  "improvement",
] as const;

export type AgentDomain = (typeof domains)[number];
export type AgentCompetency = (typeof competencies)[number];
export type AgentPhase = (typeof phases)[number];

export type AgentTool =
  | "repository-read"
  | "code-analysis"
  | "test-design"
  | "documentation"
  | "github-read"
  | "github-draft-write"
  | "security-review"
  | "architecture-review";

export type CoreAgent = {
  id: string;
  name: string;
  domain: AgentDomain;
  specialty: string;
  systemPrompt: string;
  allowedTools: readonly AgentTool[];
  requiresHumanApproval: boolean;
  qualityGates: readonly string[];
};

export type LogicalAgent = {
  id: string;
  slot: number;
  name: string;
  domain: AgentDomain;
  competency: AgentCompetency;
  phase: AgentPhase;
  specialty: string;
};

const safetyRules = [
  "Behaupte keine nicht ausgeführten Tests, Builds, Tool-Aufrufe oder GitHub-Aktionen.",
  "Gib keine Schlüssel, Tokens, Passwörter oder Secrets aus.",
  "Umgehe keine Providerlimits, Zugangsschutzmaßnahmen oder Sicherheitsregeln.",
  "Repository-Änderungen erfolgen nur über freigegebene Werkzeuge und Draft-PRs.",
].join(" ");

export const CORE_AGENTS: readonly CoreAgent[] = [
  {
    id: "project-manager",
    name: "Projektleiter",
    domain: "planning",
    specialty: "Auftragsklärung, Priorisierung und Delegation",
    systemPrompt: `Zerlege Aufträge in überprüfbare Teilaufgaben, erkenne Risiken und definiere Erfolgskriterien. ${safetyRules}`,
    allowedTools: ["code-analysis", "architecture-review"],
    requiresHumanApproval: false,
    qualityGates: ["PLAN_REVIEW"],
  },
  {
    id: "requirements-analyst",
    name: "Anforderungsanalyst",
    domain: "planning",
    specialty: "Anforderungen, Akzeptanzkriterien und Randfälle",
    systemPrompt: `Analysiere Anforderungen auf Unklarheiten, Annahmen, Randfälle und messbare Akzeptanzkriterien. ${safetyRules}`,
    allowedTools: ["code-analysis", "documentation"],
    requiresHumanApproval: false,
    qualityGates: ["PLAN_REVIEW"],
  },
  {
    id: "software-architect",
    name: "Softwarearchitekt",
    domain: "architecture",
    specialty: "Komponenten, Schnittstellen, Datenflüsse und Wartbarkeit",
    systemPrompt: `Bewerte Systemgrenzen, Architektur, Datenflüsse, Fehlerfälle und langfristige Wartbarkeit. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "code-analysis",
      "architecture-review",
      "github-read",
    ],
    requiresHumanApproval: false,
    qualityGates: ["PLAN_REVIEW", "SECURITY_REVIEW"],
  },
  {
    id: "frontend-engineer",
    name: "Frontend-Entwickler",
    domain: "frontend",
    specialty: "React, Vite, UX, State und Accessibility",
    systemPrompt: `Entwickle robuste Frontend-Lösungen mit klaren Lade-, Fehler- und Leerzuständen. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "code-analysis",
      "test-design",
      "github-read",
      "github-draft-write",
    ],
    requiresHumanApproval: false,
    qualityGates: ["TYPECHECK", "UNIT_TESTS", "ACCESSIBILITY_REVIEW"],
  },
  {
    id: "backend-engineer",
    name: "Backend-Entwickler",
    domain: "backend",
    specialty: "Express, tRPC, APIs, Validierung und Ownership",
    systemPrompt: `Entwickle sichere Serverfunktionen mit Eingabevalidierung, Fehlerbehandlung und Berechtigungsprüfung. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "code-analysis",
      "test-design",
      "security-review",
      "github-read",
      "github-draft-write",
    ],
    requiresHumanApproval: false,
    qualityGates: ["TYPECHECK", "UNIT_TESTS", "SECURITY_REVIEW"],
  },

  {
    id: "database-engineer",
    name: "Datenbank-Entwickler",
    domain: "database",
    specialty: "Drizzle, MySQL, Migrationen und Datenintegrität",
    systemPrompt: `Erstelle additive, rückwärtskompatible Datenmodelle und Migrationen mit passenden Indizes. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "code-analysis",
      "test-design",
      "security-review",
      "github-read",
      "github-draft-write",
    ],
    requiresHumanApproval: false,
    qualityGates: ["TYPECHECK", "UNIT_TESTS", "SECURITY_REVIEW"],
  },
  {
    id: "test-engineer",
    name: "Testingenieur",
    domain: "testing",
    specialty: "Unit-, Integrations- und Regressionstests",
    systemPrompt: `Definiere Teststrategie, Fehlerfälle und Regressionstests. Markiere Tests nur mit echtem Runner-Ergebnis als ausgeführt. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "code-analysis",
      "test-design",
      "github-read",
      "github-draft-write",
    ],
    requiresHumanApproval: false,
    qualityGates: ["UNIT_TESTS", "REGRESSION_TESTS"],
  },
  {
    id: "security-reviewer",
    name: "Security-Reviewer",
    domain: "security",
    specialty: "Auth, Rechte, Eingaben, Datenzugriff und Secrets",
    systemPrompt: `Prüfe Sicherheitsgrenzen und dokumentiere Risiken nachvollziehbar. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "code-analysis",
      "security-review",
      "github-read",
    ],
    requiresHumanApproval: true,
    qualityGates: ["SECURITY_REVIEW"],
  },
  {
    id: "devops-engineer",
    name: "DevOps-Ingenieur",
    domain: "devops",
    specialty: "Build, Deployment, Betrieb und Observability",
    systemPrompt: `Bewerte CI, Build, Deployment, Konfiguration, Monitoring und Betriebsrisiken. ${safetyRules}`,
    allowedTools: ["repository-read", "code-analysis", "github-read"],
    requiresHumanApproval: true,
    qualityGates: ["BUILD"],
  },
  {
    id: "documentation-writer",
    name: "Dokumentations-Agent",
    domain: "documentation",
    specialty: "README, API-, Betriebs- und Entwicklerdokumentation",
    systemPrompt: `Dokumentiere nur belegte Funktionen, Konfigurationen und Grenzen. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "documentation",
      "github-read",
      "github-draft-write",
    ],
    requiresHumanApproval: false,
    qualityGates: ["DOCUMENTATION_REVIEW"],
  },
  {
    id: "github-reviewer",
    name: "GitHub-Reviewer",
    domain: "github",
    specialty: "Repository-Analyse, Agenten-Branches und Draft-PRs",
    systemPrompt: `Arbeite nur im verbundenen Repository. Änderungen nur auf agent/*-Branches und ausschließlich als Draft-PR. ${safetyRules}`,
    allowedTools: [
      "repository-read",
      "code-analysis",
      "github-read",
      "github-draft-write",
    ],
    requiresHumanApproval: true,
    qualityGates: ["GITHUB_REVIEW"],
  },
] as const;

export function getLogicalAgent(slot: number): LogicalAgent {
  if (!Number.isInteger(slot) || slot < 1 || slot > LOGICAL_AGENT_CAPACITY) {
    throw new RangeError(
      `Agentenplatz muss zwischen 1 und ${LOGICAL_AGENT_CAPACITY} liegen.`
    );
  }

  const zeroBasedSlot = slot - 1;

  const domain = domains[zeroBasedSlot % domains.length];

  const competency =
    competencies[
      Math.floor(zeroBasedSlot / domains.length) % competencies.length
    ];

  const phase =
    phases[
      Math.floor(zeroBasedSlot / (domains.length * competencies.length)) %
        phases.length
    ];

  return {
    id: `logical-${slot}`,
    slot,
    name: `${domain} · ${competency} · ${phase}`,
    domain,
    competency,
    phase,
    specialty: `${competency} im Fachbereich ${domain} während der Phase ${phase}`,
  };
}

export function listLogicalAgents(): LogicalAgent[] {
  return Array.from({ length: LOGICAL_AGENT_CAPACITY }, (_, index) =>
    getLogicalAgent(index + 1)
  );
}

export function getCoreAgent(id: string): CoreAgent | undefined {
  return CORE_AGENTS.find(agent => agent.id === id);
}

export function selectCoreAgentsForTask(prompt: string): CoreAgent[] {
  const text = prompt.toLowerCase();

  const selected = new Set<string>(["project-manager", "requirements-analyst"]);

  if (/architektur|komponente|datenfluss|schnittstelle/.test(text)) {
    selected.add("software-architect");
  }

  if (/react|frontend|ui|ux|vite|accessibility/.test(text)) {
    selected.add("frontend-engineer");
  }

  if (/backend|server|api|trpc|express/.test(text)) {
    selected.add("backend-engineer");
  }

  if (/mysql|datenbank|drizzle|migration|schema/.test(text)) {
    selected.add("database-engineer");
  }

  if (/test|vitest|regression|qualität/.test(text)) {
    selected.add("test-engineer");
  }

  if (/auth|rechte|security|sicher|token|secret/.test(text)) {
    selected.add("security-reviewer");
  }

  if (/deploy|build|ci|docker|render|betrieb/.test(text)) {
    selected.add("devops-engineer");
  }

  if (/github|branch|pull request|repository|repo/.test(text)) {
    selected.add("github-reviewer");
  }

  if (/readme|dokumentation|docs|anleitung/.test(text)) {
    selected.add("documentation-writer");
  }

  return CORE_AGENTS.filter(agent => selected.has(agent.id));
}
