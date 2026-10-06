# Release-Checkliste & Deployment-Handbuch (Agenten-Villa)

Dieses Dokument beschreibt das Versionsschema, den Migrations- und Rollback-Prozess, die Monitoring-Endpunkte, den Render-Deploy-Flow inklusive der Recovery-Route (`render-restore`) sowie das automatische Prüfskript `scripts/release-check.sh`.

---

## 1. Versionsschema

Das Projekt folgt den Prinzipien von **Semantic Versioning (SemVer 2.0.0)**:

$$ \text{MAJOR} . \text{MINOR} . \text{PATCH} $$

* **MAJOR**: Inkompatible API-Änderungen oder tiefgreifende Architekturwechsel.
* **MINOR**: Abwärtskompatible neue Features, Sprint-Releases, neue Provider-Integrationen or Schema-Erweiterungen.
* **PATCH**: Abwärtskompatible Bugfixes, Refactorings, Security-Patches und Performance-Optimierungen.

### Versionierungspunkte im Code
1. **`package.json`**: Das Feld `"version"` (aktuell z. B. `1.1.4` bzw. `1.2.0`) dient als Single Source of Truth.
2. **Öffentlicher Health-Endpoint (`/api/health`)**: Liest dynamisch `package.json` ein und gibt die Version im JSON-Feld `version` zurück.
3. **Git-Release-Tags**:
   - Sprint-Checkpoints: `release-NNN` (z. B. `release-089`).
   - SemVer-Releases: `vX.Y.Z` (z. B. `v1.1.4`, `v1.2.0`).

---

## 2. Migrations-Schritte

### Stand im Repository
* **Datenbank**: Neon PostgreSQL.
* **ORM & Migrations-Tool**: Drizzle ORM (`drizzle-orm`, `drizzle-kit`).
* **Schema-Definition**: `drizzle/schema.ts`.
* **Migrations-Dateien**: `drizzle/0000_...sql` bis `drizzle/0015_...sql`.
* **Fallback**: Wenn keine `DATABASE_URL` gesetzt ist (z. B. in lokalen Tests), arbeitet der Server im In-Memory-Modus mit degradierten Persistenzfunktionen.

### Ausführung von Migrationen
1. **Lokal / Manuell**:
   ```bash
   DATABASE_URL="postgres://user:pass@host/dbname?sslmode=require" pnpm db:push
   ```
   *`pnpm db:push` führt intern `drizzle-kit generate && drizzle-kit migrate` aus.*

2. **Automatisiert in CI/CD**:
   * GitHub Actions Workflow: `.github/workflows/db-migrate.yml` (`workflow_dispatch`).
   * Wendet ausstehende Drizzle-Migrationen ohne SSH-Zugriff direkt auf die Neon-Datenbank an.

### Pre-Deploy-Checkliste
1. Release-Prüfskript ausführen:
   ```bash
   ./scripts/release-check.sh
   # oder
   pnpm release:check
   ```
2. Sicherstellen, dass TypeScript (`pnpm check`), Tests (`pnpm test`) und Build (`pnpm build`) grün sind.
3. Datenbank-Erreichbarkeit und Schema-Konsistenz vorab prüfen.

### Post-Deploy-Verifikation
1. Aufruf von `GET https://agenten-villa.onrender.com/api/health`.
2. Verifizieren, dass `"ok": true` und `database.status` den Wert `"verbunden"` liefert.

---

## 3. Rollback-Weg

Sollte ein Deployment in Produktion Fehler aufweisen, stehen folgende Wiederherstellungspfade bereit:

### A. Git Code Rollback
1. Identifikation des letzten stabilen Tag-Stands (z. B. `release-088` oder Commit-SHA).
2. Erstellen eines Hotfix-/Rollback-Branches oder Revert-Commits:
   ```bash
   git revert <bad-commit-sha>
   git push origin main
   ```
3. Push auf `main` triggert automatisch ein neues Render-Build des stabilen Stands.

### B. Render Deploy Rollback
1. Über die Render API oder das Render-Dashboard den letzten erfolgreichen Deploy auswählen.
2. Trigger Redeploy (`POST /v1/services/srv-dar9h6id0e5s73c0c050/deploys` mit der `deployId` des vorherigen Stands).

### C. Datenbank-Rollback-Strategie
* **Abwärtskompatible Schema-Änderungen**: Schema-Migrationen dürfen in Produktion spaltenbezogen nur additiv oder nullable erfolgen (kein hartes Löschen von Spalten ohne Übergangsphase).
* Sollte eine Drizzle-Migration rückgängig gemacht werden müssen, ist ein abwärtskompatibles Gegen-Migrations-Skript als neuer Drizzle-Schritt einzureichen.

### D. Router- & Controller-Zustand
* Der Router- und Controller-Status wird im In-Memory-Cache und in `data/controller-state.json` / `data/route-override.json` verwaltet.
* Ein fehlerhafter Admin-Route-Pin kann jederzeit über die tRPC-Admin-Schnittstelle (`systemRouter.routingOverride(provider: null)`) gelöscht werden.

---

## 4. Monitoring-Checks (Health & Metriken)

### Öffentlicher Health-Endpoint (`GET /api/health`)
* **Zugriff**: Öffentlich, unauthentifiziert, sofortige Antwort (gecacht, nie blockierend).
* **Verwendung**: Render Health Check, Smoke-Tests, Uptime-Monitoring.
* **Payload-Struktur**:
  ```json
  {
    "ok": true,
    "version": "1.1.4",
    "mode": "production",
    "uptimeSec": 1234,
    "timestamp": "2026-10-07T00:00:00.000Z",
    "database": {
      "status": "verbunden",
      "latencyMs": 12
    },
    "controller": {
      "status": "RUNNING",
      "activeWorkers": 1,
      "tickCount": 42,
      "lastTickAt": "2026-10-07T00:00:00.000Z"
    },
    "providers": [
      {
        "name": "ollama",
        "configured": true,
        "cooldown": false
      },
      {
        "name": "openrouter",
        "configured": true,
        "cooldown": true,
        "cooldownKind": "limit",
        "cooldownSecLeft": 180
      }
    ],
    "routing": {
      "pinned": null,
      "pinnedBy": null,
      "activeRoute": "ollama"
    }
  }
  ```

### Metriken & Telemetrie
* **Prozessmetriken (`agentMetricsSummary()`)**:
  * Erfasst Agentenläufe (completed, partial, failed), Fehlercodes und mittlere Ausführungsdauer (`averageDurationMs`).
* **Router-Telemetrie (`routerTelemetrySummary()`)**:
  * Erfasst Latenzen, Erfolgsraten, Fallback-Gründe und Provider-Wechsel.
* **Token-/Budget-Nutzung (`turnUsageSummary()`)**:
  * Aggregiert verbrauchte Tokens und geschätzte Kosten je Provider.
* **Zugriffsschutz**:
  * Metriken werden im 24/7 Watchdog-Controller gebündelt.
  * Der Zugriff auf detaillierte Metriken und Steuerung erfolgt geschützt über tRPC Admin-Prozeduren (`adminProcedure`), die eine gültige Admin-Sitzung (`AGENT_ADMIN_EMAIL`) erfordern, oder über den geschützten SSE-Stream `/api/controller`.

---

## 5. Render-Deploy-Flow & Recovery-Route

### Automatischer Deploy-Flow
1. Jeder Merge/Push auf den Branch `main` triggert automatisch den Render Build & Deploy Prozess.
2. Render führt den Docker-Build aus (`Dockerfile`) und startet den Web-Service (`https://agenten-villa.onrender.com`).
3. Nach dem Start führt Render den Health-Check auf `/api/health` aus.

### Recovery-Route: `render-restore` Workflow
Sollte die Umgebungskonfiguration auf Render beschädigt werden oder verloren gehen, existiert ein automatisierter Recovery-Workflow:

* **Workflow-Datei**: `.github/workflows/render-restore.yml`
* **Auslösung**: Manuell via `workflow_dispatch` in GitHub Actions.
* **Funktion**:
  1. Validiert vorhandene Secrets (`DATABASE_URL`, `OPENROUTER_API_KEY`, `SERVER_GITHUB_TOKEN`, `GEMINI_API_KEY`, `HF_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`).
  2. Führt Live-Plausibilitätsprüfungen durch (Präfixe, Token-Aktivität bei GitHub/OpenRouter, Google OAuth-Paar).
  3. Schreibt die komplette Variablenliste direkt an Render zurück.
  4. Löst ein neues Deployment aus und wartet, bis der Service wieder `live` ist.

### WICHTIGE REGEL: Env-Variablen NIE per partieller Bulk-PUT erweitern!
> **WARNUNG**: Ein API-PUT auf das Render-Endpunkt `/v1/services/{serviceId}/env-vars` ersetzt die **gesamte** Umgebungsvariablen-Liste auf Render! Ein unbedachter PUT mit nur einer geänderten Variable löscht alle anderen Variablen ersatzlos.
> 
> **Pflicht-Prozedur beim Schreiben von Render-Umgebungsvariablen**:
> 1. Immer zuerst die bestehende Liste aller Variablen via `GET /v1/services/{serviceId}/env-vars` lesen.
> 2. Die neuen/geänderten Variablen lokal mit der bestehenden Liste **mergen**.
> 3. Das **vollständige, gemergte Gesamt-Array** per `PUT /v1/services/{serviceId}/env-vars` schreiben.

---

## 6. Automatisches Prüfskript (`scripts/release-check.sh`)

Das Skript `scripts/release-check.sh` dient als lokales Gatekeeper-Werkzeug vor jedem Release.

### Verwendung
```bash
./scripts/release-check.sh
# oder via pnpm
pnpm release:check
```

### Ablauf
1. **TypeScript-Typprüfung (`pnpm check`)**: Stellt sicher, dass keine Type-Errors vorliegen.
2. **Test-Suite (`pnpm test`)**: Führt alle Vitest-Unit- und Integrationstests aus (mit isolierter Test-Umgebung).
3. **Produktions-Build (`pnpm build`)**: Führt den Client- (Vite) und Server-Build (esbuild) aus.
4. **Zusammenfassung & Exit-Code**: Gibt eine Übersicht aus. Der Exit-Code ist **0 nur wenn alle drei Schritte grün sind**, andernfalls **non-zero**.
