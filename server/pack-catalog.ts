/**
 * Sprint 042 — Capability-Packs katalogisieren: Jedes Pack beschreibt Zweck,
 * Berechtigungen und Grenzen. Der Katalog ist die eine autoritative Stelle:
 * Er fusioniert die Pack-Definitionen aus agent-villa.ts mit der
 * Berechtigungs-/Grenzen-Autorität und validiert jeden Eintrag gegen ein
 * Zod-Schema. Fehlt einem Pack die Katalogisierung, wirft der Katalog —
 * kein Pack darf unbeschrieben bleiben.
 */
import { z } from "zod";
import { CAPABILITY_PACKS } from "./agent-villa";

export const capabilityPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["feature", "tool", "developer", "system", "skill", "connector"]),
  /** Zweck: was das Pack leistet. */
  purpose: z.string().min(20),
  /** Berechtigungen: was das Pack ausdrücklich darf. */
  permissions: z.array(z.string().min(3)).min(1),
  /** Grenzen: was das Pack ausdrücklich nie tut oder nie überschreitet. */
  limits: z.array(z.string().min(3)).min(1),
  administratorOnly: z.boolean(),
  enabledByDefault: z.boolean(),
});

export type PackCatalogEntry = z.infer<typeof capabilityPackSchema>;

type PackAuthority = { permissions: string[]; limits: string[] };

/** Berechtigungen und Grenzen je Pack — vollständig, sonst wirft der Katalog. */
const PACK_AUTHORITY: Record<string, PackAuthority> = {
  "villaforge-mission-planner": {
    permissions: ["Missionslokale Arbeitsplanung mit Rollen und OPTIMIZE/REBUILD-Strategie"],
    limits: ["Nur Offline-Arbeitsplan", "Keine Shell- oder Worker-Rechte", "Gedächtnis nur missionslokal"],
  },
  "agent-orchestration": {
    permissions: ["Logische Agentenplätze bei Bedarf provisionieren", "Rollen und Arbeitszyklen zuweisen"],
    limits: ["Lazy-Provisionierung — keine Kapazität im Leerlauf", "Keine unnötigen parallelen Modellaufrufe"],
  },
  "elite-project-factory": {
    permissions: ["Elite-Missionen starten und Repository für die Mission lesen", "Auf eigenen agent/*-Branches implementieren"],
    limits: ["Nur Administratoren", "Maximal 24 kontrollierte GitHub-Aktionen je Mission", "Ergebnis ausschließlich als Draft-PR"],
  },
  "multi-agent-delegation": {
    permissions: ["Große Aufgaben in Architektur, Entwicklung, Tests, Review und Dokumentation aufteilen"],
    limits: ["Nur Administratoren", "Keine unnötigen parallelen Modellaufrufe"],
  },
  "safe-provider-router": {
    permissions: ["Konfigurierte Free-Tier-Anbieter anfragen", "Cache und Deduplizierung nutzen"],
    limits: ["Keine Quoten- oder Kostenumgehung", "Hugging Face nur mit ausdrücklicher Einwilligung", "Terminalfehler fail-closed"],
  },
  "provider-guardian": {
    permissions: ["Kostenlose Modellrouten fortlaufend prüfen", "Tote oder limitierte Routen in Cooldown setzen"],
    limits: ["Nur Administratoren", "Erzeugt keine Token", "Umgeht keine Anbieterkontingente"],
  },
  "project-workshop": {
    permissions: ["Planungs-, Prüfungs- und Entwicklungsworkflows ausführen"],
    limits: ["Nur im Werkstatt-Modus verfügbar"],
  },
  "idea-to-product": {
    permissions: ["Produktidee in Scope, Architektur und Meilensteine überführen"],
    limits: ["Nur Administratoren", "Auslieferung nur als Repository-Entwurf bzw. Draft-PR"],
  },
  "software-architecture": {
    permissions: ["Vorhandene Strukturen analysieren und kompatible Module entwerfen"],
    limits: ["Nur kompatible Änderungsschritte — keine autonom geplanten Fremdprojekte"],
  },
  implementation: {
    permissions: ["Produktionsnahen Code im verbundenen Projekt erstellen und überarbeiten"],
    limits: ["Kein Schreibzugriff auf den Default-Branch", "Nur im Rahmen der Sicherheitsgrenzen des Projekts"],
  },
  "code-analysis": {
    permissions: ["Typprüfung, Architektur- und Abhängigkeitsanalyse lesen"],
    limits: ["Nur lesend — keine Änderungen"],
  },
  "test-generation": {
    permissions: ["Unit-, Integrations- und Regressionstests erzeugen und prüfen"],
    limits: ["Nur für das verbundene Projekt"],
  },
  "security-review": {
    permissions: ["Eingaben, Berechtigungen und Secret-Grenzen vor der Übergabe prüfen"],
    limits: ["Nur lesend", "Keine Secrets im Klartext in Berichten"],
  },
  documentation: {
    permissions: ["Technische Dokumentation und PR-Beschreibungen erstellen"],
    limits: ["Nur dokumentierende Artefakte — keine Code-Autonomie"],
  },
  "acceptance-criteria": {
    permissions: ["Prüfbare Akzeptanzkriterien und Definition of Done ableiten"],
    limits: ["Nur Administratoren", "Kriterien müssen prüfbar formuliert sein"],
  },
  "regression-guard": {
    permissions: ["Gezielte Regressionstests bei Verhaltensänderungen ergänzen"],
    limits: ["Bestehende Tests müssen grün bleiben"],
  },
  "dependency-hygiene": {
    permissions: ["Abhängigkeiten und Lockfile-Konsistenz prüfen"],
    limits: ["Keine unnötigen neuen Pakete", "SDK-Majors erst nach Migrationsbereitschaft"],
  },
  "build-verify": {
    permissions: ["Typecheck, Tests und Build über vorhandene Projektskripte ausführen"],
    limits: ["Nur Administratoren", "Nur echte Ergebnisse — keine behaupteten Erfolge"],
  },
  "change-review": {
    permissions: ["Eigene Änderungen erneut lesen und prüfen"],
    limits: ["Nur im Rahmen der Akzeptanzkriterien der eigenen Mission"],
  },
  "handoff-summary": {
    permissions: ["Prüfbare Übergabe mit Dateien, Teststand und Draft-PR-Verweis erstellen"],
    limits: ["Nur verifizierbare Angaben — keine Behauptungen"],
  },
  "github-read": {
    permissions: ["Repository-Überblick, Dateien, Baum, Commits, Issues, Pull Requests und Check-Runs lesen"],
    limits: ["Nur lesend", "Maximal 10 Commits je Aufruf", "Maximal 500 Baum-Einträge", "Maximal 16.000 Zeichen je Datei"],
  },
  "github-draft-writes": {
    permissions: ["Eigene agent/*-Branches erstellen und beschreiben", "Draft-PR öffnen"],
    limits: [
      "Nur auf Branches, die in derselben Runde erstellt wurden",
      "Kein Zugriff auf Default-Branch, Workflows, Secrets oder Berechtigungen",
      "Nur Administratoren",
      "Maximal 3 Aktionen je Chat-Turn",
    ],
  },
  "ci-observer": {
    permissions: ["GitHub Check-Runs lesen"],
    limits: ["Nur lesend", "Nur Administratoren"],
  },
  "openrouter-free": {
    permissions: ["Konfigurierte OpenRouter-Free-Modelle aufrufen"],
    limits: ["Nur Free-Modelle", "Anbieterkontingente gelten unverändert"],
  },
  "huggingface-fallback": {
    permissions: ["Kostenlosen HF-Fallback nutzen"],
    limits: ["Nur mit ausdrücklicher Einwilligung", "Nur bei vorübergehendem Ausfall", "Maximal ein Fallback je Anfrage"],
  },
  "github-connector": {
    permissions: ["Repository-Zugriff über serverseitigen Token"],
    limits: ["Token bleibt serverseitig geschützt", "Branch- und Draft-PR-Grenzen gelten immer", "Nur Administratoren"],
  },
  "postgres-memory": {
    permissions: ["Villen, Nachrichten und Bewertungen über PostgreSQL persistieren"],
    limits: ["Nur über PostgreSQL/Neon", "Keine Nutzdaten oder Secrets in Telemetrie"],
  },
  "audit-trail": {
    permissions: ["Entscheidungen und externe Grenzen nachvollziehbar protokollieren"],
    limits: ["Keine Secrets im Protokoll"],
  },
};

/** Der vollständige, schema-validierte Pack-Katalog. */
export function getPackCatalog(): PackCatalogEntry[] {
  return CAPABILITY_PACKS.map(pack => {
    const authority = PACK_AUTHORITY[pack.id];
    if (!authority)
      throw new Error(
        `Pack ${pack.id} ist nicht katalogisiert: Berechtigungen und Grenzen fehlen.`
      );
    return capabilityPackSchema.parse({
      id: pack.id,
      name: pack.name,
      kind: pack.kind,
      purpose: pack.description,
      permissions: authority.permissions,
      limits: authority.limits,
      administratorOnly: Boolean(pack.administratorOnly),
      enabledByDefault: pack.enabledByDefault,
    });
  });
}
