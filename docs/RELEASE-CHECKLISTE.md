# Release-Checkliste

Diese Checkliste beschreibt den verbindlichen Ablauf für Releases der Agenten-Villa.
Alle Schritte müssen vor einem Release abgearbeitet werden.

## 1. Versionierung

- [ ] `package.json` `"version"` auf die Ziel-Version setzen (z. B. `1.0.0`, `1.1.0-rc.1`).
- [ ] Commit mit Versionsbumo ist der Release-Commit; sein voller SHA wird für den
  APK-Build als `ref`-Input verwendet (siehe `AGENTS.md` → "Release-Ablauf").
- [ ] Kein Git-Tag und kein GitHub-Release werden vom Agenten erstellt — das bleibt
  eine Owner-Entscheidung.

## 2. APK-Release-Ablauf

Siehe `AGENTS.md` → "Release-Ablauf" und `docs/APK.md`.

- [ ] APK per `workflow_dispatch` mit vollem Commit-SHA als `ref`-Input bauen — aus
  genau dem Commit, der getaggt wird, nicht aus einem älteren Artefakt.
- [ ] Anschließend annotiertes Tag pushen und Release anlegen (Owner-Schritt).
- [ ] Baum des Merge-Commits mit dem Release-Commit vergleichen:
  `git diff --quiet <release> <merge>` muss leer bleiben.
- [ ] SHA-1-Fingerabdruck des Keystores in der Google-Konsole
  (`de.niknight1403.agentenvilla`) hinterlegt — sonst liefert Google Code 10
  (`DEVELOPER_ERROR`). Siehe `docs/APK.md`.
- [ ] APK-Hash-Vergleich: Die beiden APK-Dateien unterscheiden sich bei jedem Build
  (Zip-Zeitstempel, Padding in der Signatur). Zum Vergleich den Web-Payload
  (`assets/public/**`) und `assets/capacitor.config.json` hashen, nicht die ganze
  APK. Siehe auch `scripts/build-manifest.ts` (Sprint 088/Repo-Sprint 088).

## 3. Datenbankmigration

Siehe `drizzle/` (Migrationen 0000–0014) und `AGENTS.md` → Neon-Abschnitt.

- [ ] `pnpm db:push` gegen die Neon-DB ausführen. Danach meldet `/api/health`
  `database.status: "verbunden"`.
- [ ] Neue Migrationen nur vorwärts ausführen. Datenbankmigrationen werden **nicht**
  rückwärts ausgeführt, solange kein getesteter Rückwärtsweg vorhanden ist (siehe
  `docs/BRANCH-PROTECTION.md` → "Rollback").
- [ ] Migrationen nach dem Push verifizieren: Tabellen-Schema in Neon-Konsole prüfen.
- [ ] Keine echten Datenbank-Zugangsdaten im Code oder in Skripten hinterlegen
  (`DATABASE_URL` per Env-Variablen, niemals festkodiert).

## 4. Rollback

Siehe `docs/BRANCH-PROTECTION.md` → "Rollback".

- [ ] Vor riskanten Änderungen wird ein Commit oder Checkpoint festgehalten.
- [ ] Ein Rollback wird durch Wiederherstellung eines bekannten Commit- oder
  Checkpoint-Stands durchgeführt.
- [ ] Datenbankmigrationen werden nicht rückwärts ausgeführt, solange kein
  getesteter Rückwärtsweg vorhanden ist. Bei Bedarf wird der Rollback-Weg zuvor
  deterministisch getestet (siehe Sprint 089 → Rollback-Test).
- [ ] Rollback-Commit dokumentieren: welcher Stand, warum, welche Migrationen
  betroffen sind.

## 5. Monitoring

### Health-Endpunkt 2.0

Siehe `server/_core/health.ts`.

- [ ] `GET /api/health` liefert: `database.status` ("verbunden" / "fehler"),
  `providerGuardian`-Zustand, `eliteUnlimited`-Status.
- [ ] Nach `pnpm db:push` muss `database.status: "verbunden"` zurückgemeldet werden.
- [ ] tRPC `agent.status` liefert zusätzlich `providers` und `providerRouting`.

### Controller-SSE

Siehe `server/controller-sse.ts` und `server/controller.ts`.

- [ ] Der 24/7-Watchdog-Controller (`server/controller.ts`) läuft beim Serverstart
  (siehe `server/_core/index.ts`) und sendet Server-Sent-Events über
  `server/controller-sse.ts`.
- [ ] SSE-Endpunkt liefert Worker-Zähler, Tick-Intervall und Gesundheitsdaten.
- [ ] Notfallstop ist über bestehende Stop-Mechanismen erreichbar (nur dokumentieren,
  nichts erfinden — siehe `AGENTS.md` → Controller/Watchdog).

### Provider-Guardian

Siehe `server/provider-guardian.ts`.

- [ ] Der Provider-Guardian läuft beim Serverstart und updated im Intervall
  `PROVIDER_GUARDIAN_INTERVAL_MS` (Default 300000 ms).
- [ ] `guardianChain()` sortiert `OPENROUTER_MODELS` nach echter Gesundheit.
- [ ] tRPC-Admin-Sichten: `agent.guardian` (Query), `agent.runProviderGuardian`,
  `agent.setProviderGuardian` — alle admin-gated.

## 6. Auto-Merge-Gate

Siehe `docs/BRANCH-PROTECTION.md` → "Auto-Merge für agent/*-PRs" und
`server/auto-merge-gate.ts`.

- [ ] Alle Pflichtchecks (`CI`, `PR Agent (Gemini)`, `Android mobile smoke`) müssen
  grün sein.
- [ ] Pfadgefilterte Checks gelten als erfüllt, wenn ihr `paths:`-Filter nicht
  triggern würde (Sprint 081).
- [ ] Nicht automatisch gemerged: Drafts, Fork-PRs, PRs mit `.github/`-Änderungen,
  PRs die `server/auto-merge-gate.ts` oder `docs/BRANCH-PROTECTION.md` ändern.

## 7. Qualitäts-Gate (lokal vor PR)

- [ ] `pnpm check` — TypeScript ohne Emit
- [ ] `pnpm test` — Unit- und Regressionstests
- [ ] `pnpm build` — Produktionsartefakt (Vite + esbuild)
- [ ] `git diff --check` — Whitespace- und Patch-Hygiene

## 8. Sicherheitsgrenzen (vor Release verifizieren)

- [ ] Kein `limit-bypass`-Pack vorhanden (`agent-villa.test.ts` prüft das).
- [ ] Kein Passwort-Login — ausschließlich Google OAuth
  (`server/_core/googleAuth.ts`, `server/_core/nativeAuth.ts`).
- [ ] Admin-Zugriff nur über Allowlist `AGENT_ADMIN_EMAIL`.
- [ ] Keine Secrets im Code, keine Provider-Live-Aufrufe in deterministischen Tests.
- [ ] Row-Level Security / Ownership-Prüfung aktiv für Nutzerdaten.
