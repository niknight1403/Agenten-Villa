# Agenten-Villa

Agenten-Villa ist eine sichere Agenten-Werkstatt für die Entwicklung am verbundenen Projekt. Jede Villa stellt **5.000 logisch provisionierbare Agentenplätze** bereit. Die Plätze werden lazy erzeugt, damit im Leerlauf keine 5.000 Modellanfragen, Kosten oder externen Prozesse entstehen.

## Architektur

Die Orchestrierung bündelt Feature-, Tool-, Entwickler- und System-Packs. Standardmäßig aktiviert sind Agenten-Orchestrierung, sicherer Provider-Router, Projekt-Werkstatt, GitHub-Lesen, geschützte Draft-Änderungen, Code-Analyse, Test-Erstellung und Audit-Protokollierung.

Der Provider-Router wählt ausschließlich konfigurierte und erlaubte Anbieter. `openrouter/free` ist die primäre kostenlose Route. Ein Hugging-Face-Fallback ist nur nach ausdrücklicher Aktivierung und bei einem vorübergehenden Ausfall vorgesehen. HTTP-Status 402 und 429 werden als erschöpftes Kontingent behandelt und nicht umgangen.

**Stack:** React 19 + Vite (Client, tRPC über `@tanstack/react-query`), Express + tRPC (Server), Drizzle ORM mit MySQL (`mysql2`), pnpm als Paketmanager.

## Umgebungsvariablen

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | MySQL-Verbindung (Pflicht, auch für `pnpm db:push`) |
| `OPENROUTER_API_KEY` | Primäre kostenlose Modellroute |
| `HF_TOKEN` | Optionaler, explizit aktivierbarer Fallback |
| `GITHUB_TOKEN` | Server-Secret für geschützte GitHub-Werkzeuge |
| `AGENT_ADMIN_EMAIL` | Allowlist-Administrator (alternativ: Rolle `admin`) |

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
pnpm check   # TypeScript ohne Emit prüfen
pnpm test    # Vitest (Unit- und Regressionstests)
pnpm build   # Vite-Build + esbuild-Server-Bundle
pnpm dev     # lokaler Entwicklungsserver mit Vite
```

Datenbankmigrationen laufen über `pnpm db:push` (Drizzle Kit). Build-Skripte für `esbuild` und `@tailwindcss/oxide` sind über `pnpm.onlyBuiltDependencies` freigegeben.

## Tests

Die Testsuite deckt Provider-Routing (inklusive Fail-Closed bei 429/402), die GitHub-Tool-Schleife mit Branch-/Draft-PR-Regeln, Eingabevalidierung, sichere Fehlermeldungen, Stundenlimits samt Fenster-Reset und die Villa-Orchestrierung ab. Live-Tests für Provider-Credentials sind markiert und laufen nur mit echten Schlüsseln.
