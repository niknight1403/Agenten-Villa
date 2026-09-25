# Agenten-Villa

Agenten-Villa ist eine sichere Agenten-Werkstatt für die Entwicklung am verbundenen Projekt. Jede Villa stellt **5.000 logisch provisionierbare Agentenplätze** bereit. Die Plätze werden lazy erzeugt, damit im Leerlauf keine 5.000 Modellanfragen, Kosten oder externen Prozesse entstehen.

## Architektur

Die Orchestrierung bündelt Feature-, Tool-, Entwickler- und System-Packs. Standardmäßig aktiviert sind Agenten-Orchestrierung, sicherer Provider-Router, Projekt-Werkstatt, GitHub-Lesen, geschützte Draft-Änderungen, Code-Analyse, Test-Erstellung und Audit-Protokollierung.

Der Provider-Router wählt ausschließlich konfigurierte und erlaubte Anbieter. `openrouter/free` ist die primäre kostenlose Route. Ein Hugging-Face-Fallback ist nur nach ausdrücklicher Aktivierung und bei einem vorübergehenden Ausfall vorgesehen. HTTP-Status 402 und 429 werden als erschöpftes Kontingent behandelt und nicht umgangen.

## Administratorzugriff

Der konfigurierte Administrator (`AGENT_ADMIN_EMAIL`) oder ein Benutzer mit der Rolle `admin` besitzt vollständigen **Anwendungszugriff** auf Agentensteuerung, Werkstatt und geschützte GitHub-Funktionen. Anwendungslimits für normale Benutzer blockieren den Administrator nicht. Pro-Anfrage-Sicherheitsgrenzen, Provider-Kontingente, Zugangsschutz, Audit-Regeln und die GitHub-Branch-/Draft-PR-Regeln bleiben für alle Benutzer aktiv.

Es gibt bewusst keinen Limit-Umgehungsagenten, keine Schlüsselrotation, keine Identitätsvortäuschung und keine kostenpflichtige oder nicht autorisierte Ausweichroute. Diese Grenzen schützen Konten, Anbieter und das Repository.

## Status-API

`agent.status` liefert unter anderem:

- logische Kapazität und Lazy-Provisionierung der Villa,
- aktive Capability-Packs,
- Provider-Routing und Konfigurationsstatus,
- Administratorberechtigungen,
- Sicherheits- und Kontingent-Hinweise.

`agent.capabilityPacks` listet die verfügbaren Packs. `agent.villaSnapshot` liefert den Status einer Villa-ID.

## Entwicklung

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

Die lokale Entwicklung startet mit `pnpm dev`.
