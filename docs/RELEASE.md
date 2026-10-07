# Release-Checkliste & Deployment-Handbuch (Agenten-Villa)

Dieses Dokument beschreibt das Versionsschema, den Migrations- und Rollback-Prozess, die Monitoring-Endpunkte, den Render-Deploy-Flow inklusive der Recovery-Route (`render-restore`) sowie das automatische Prüfskript `scripts/release-check.sh`.

---

## 1. Versionsschema

Das Projekt folgt den Prinzipien von **Semantic Versioning (SemVer 2.0.0)**:

$$ \text{MAJOR} . \text{MINOR} . \text{PATCH} $$

* **MAJOR**: Inkompatible API-Änderungen oder tiefgreifende Architekturwechsel.
* **MINOR**: Abwärtskompatible neue Features, Sprint-Releases, neue Provider-Integrationen oder Schema-Erweiterungen.
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
3. Datenbank-Erreichbarkeit und Schema-Konsistency vorab prüfen.

### Post-Deploy-Verifikation
1. Aufruf von `GET https://agenten-villa.onrender.com/api/health`.
2. Verifizieren, dass `"ok": true` und `database.status` den Wert `"verbunden"` liefert.

---

## 3. Rollback-Weg

Sollte ein Deployment in Produktion Fehler aufweisen oder Invarianten verletzen, stehen folgende verifizierte Wiederherstellungspfade bereit:

### A. Checkpoint-Tags & Git Code Rollback
1. **Checkpoint-Tags auf main**: Jeder stabile Sprint-Stand wird auf `main` mit einem Git-Tag der Form `release-NNN` versehen (z. B. `release-089`).
2. **Rollback-Verifikationsskript**:
   ```bash
   ./scripts/rollback-verify.sh <checkpoint-tag-oder-commit>
   # Beispiel: ./scripts/rollback-verify.sh release-089
   ```
   Das Skript prüft:
   - Ist das Ziel ein gültiger Commit und Ahne (Ancestor) von `main`?
   - Sind Health-Invarianten (ok=true, valides SemVer, DB-Status verbunden, activeRoute gesetzt, Provider betriebsbereit) erfüllt?
   - Führen `pnpm check`, `pnpm test` und `pnpm build` fehlerfrei durch?
3. **Ausführung des Reverts**:
   ```bash
   git revert <bad-commit-sha>
   git push origin main
   ```
   Der Push auf `main` triggert automatisch den Render Build & Deploy Prozess.

### B. Deterministische Invarianten-Prüfung (`server/rollback-check.ts`)
Die Logik in `server/rollback-check.ts` stellt sicher, dass vor einem Rollback alle kritischen Systeminvarianten programmatisch validiert werden:
* **Checkpoint-Sicherheit**: Ein Rollback-Ziel muss älter als der aktuelle Stand, aber nicht älter als der älteste unterstützte Checkpoint sein (`isSafeRollbackTarget`).
* **Router-Config-Persistenz**: Die Route-Override-Dateien (z. B. `data/route-override.json`) müssen lesbar sein, valides JSON enthalten und einen gültigen Override-Wert besitzen (`verifyRouterConfigPersistence`).
* **Abwärtskompatibilität von Migrationen**: Drizzle-Schema-Migrationen müssen abwärtskompatibel geplant sein (`verifyMigrationsBackwardCompatible`).

### C. Lokaler/Artefakt-Checkpoint & Restore (`scripts/rollback-checkpoint.ts`)
Für das Erstellen und Wiederherstellen von Konfigurations- und Artefakt-Checkpoints steht das CLI-Tool bereit:
```bash
# Checkpoint erstellen
npx tsx scripts/rollback-checkpoint.ts create --source ./data --out ./checkpoints/chk-089 --label "pre-deploy-090"

# Checkpoint integritätsprüfen (SHA-256 Hashes & Manifest)
npx tsx scripts/rollback-checkpoint.ts verify --checkpoint ./checkpoints/chk-089

# Checkpoint wiederherstellen (idempotent)
npx tsx scripts/rollback-checkpoint.ts restore --checkpoint ./checkpoints/chk-089 --target ./data
```

### D. Render Deploy Rollback
1. Über die Render API oder das Render-Dashboard den letzten erfolgreichen Deploy auswählen.
2. Redeploy triggern (`POST /v1/services/srv-dar9h6id0e5s73c0c050/deploys` mit der `deployId` des vorherigen Stands).

### E. Datenbank-Rollback-Strategie & Richtlinie
* **Strikte Regel**: DB-Migrationen werden gemäß `docs/BRANCH-PROTECTION.md` **niemals automatisch rückwärts** ausgeführt, um Datenverlust zu vermeiden.
* **Schema-Design**: Drizzle-Migrationen in Produktion müssen spaltenbezogen **additiv** oder **nullable** gestaltet sein.
* **Notfall-Schema-Rollback**: Wenn ein Schema-Rollback zwingend erforderlich ist, muss ein getestetes Rückwärts-Migrationsskript als neuer separater Drizzle-Migrationsschritt eingereicht werden.

### F. Router- & Controller-Zustand
* Der Router- und Controller-Status wird im In-Memory-Cache und in `data/controller-state.json` / `data/route-override.json` verwaltet.
* Ein fehlerhafter Admin-Route-Pin kann jederzeit über die tRPC-Admin-Schnittstelle (`systemRouter.routingOverride(provider: null)`) gelöscht werden.


### G. Checkpoint-Tags (Sprint 090)
* Nach jedem Sprint-Abschluss wird ein Checkpoint-Tag `release-NNN` auf main gesetzt (z. B. `release-089`).
* Tags werden vor dem Merge des naechsten Sprints gesetzt, um einen stabilen Wiederherstellungspunkt zu haben.
* Ein Rollback-Ziel ist sicher, wenn:
  * Die Checkpoint-Nummer kleiner als der aktuelle Stand ist.
  * Die Checkpoint-Nummer nicht aelter als der letzte als "good" markierte Stand ist.
  * Das Verifikationsskript `scripts/rollback-verify.sh` gruen ist.
* Verifikation vor Rollback:
  ```bash
  ./scripts/rollback-verify.sh release-089
  # oder via pnpm
  pnpm rollback:verify release-089
  ```
* Das Skript prueft: Git-Existenz, Ancestor-Relation zu main, pnpm check/test/build.

### H. Router-Config-Persistenz bei Rollback (Sprint 090)
* Die Router-Config (`data/route-override.json`) bleibt bei einem Code-Rollback lesbar: das Dateiformat ist abwaertskompatibel (zusaetzliche Felder werden ignoriert).
* Der Route-Override ist prozesslokal und wird nicht persistiert — bei einem Rollback faellt die Engine zurueck in die Auto-Kette.
* Die `data/controller-state.json` enthaelt nur additive Statusfelder; aeltere Code-Versionen koennen sie sicher lesen.
* Die Logik-Module `server/rollback-check.ts` mit `verifyRouterConfigPersistence()` und `verifyHealthInvariants()` pruefen diese Invarianten deterministisch.
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
