# Sprint-Status & Fortschritts-Protokoll

## Übersicht

| Sprint  | Status  | Zusammenfassung |
|---------|---------|-----------------|
| 001–060 | Grün    | Grundlagen, Router, Engine, HITL, Security, Multi-Provider, Stabilität. |
| 061     | Grün    | Standard-Dialoge: alert, confirm, prompt durch native Custom-Dialog-Komponente (CustomDialog.tsx, useConfirm, DialogContext) ersetzt; 15/15 Native-Call-Muster auf der Chat-Seite eliminiert. |
| 062     | Grün    | Villa Factory mobil: Erstellen-Modal scrollbar statt abgeschnitten (max-height + Safe-Area, wichtig bei geöffneter Tastatur), Textareas ohne Resize-Griff, alle Eingabefelder 16px gegen iOS-Fokuszoom — auch Chat-Composer und Drawer-Suche. |
| 063     | Grün    | Reduced-Motion komplett: globaler prefers-reduced-motion-Block erzwingt jetzt animation-duration ~0 + iteration-count 1 für ALLE Animationen (deckt mic-pulse, fade/slide/modal und Tailwind animate-spin/pulse ab); .spin stoppt statt nur langsamer zu drehen. |
| 064     | Grün    | Offline-Chatcache: QueryClient auf networkMode offlineFirst umgestellt (Verlauf bleibt bei Abbruch lesbar, Cache 30 min), neuer Online-Status-Hook mit Offline-Banner im Chat ("Keine Verbindung — dein Verlauf bleibt lesbar."), 3 neue Tests; vitest nimmt jetzt hooks-Tests auf. |
| 065     | Grün    | 24/7-Watchdog-Loops (Eigentümer-Richtung, ersetzt Roadmap-065, das durch Sprint 064 vorweggenommen war): controller.ts führt einen echten, begrenzten Worker-Loop aus (Standardtakt 60 s, WATCHDOG_TICK_MS, min. 30 s) mit je Tick isolierten Segmenten — Mission-Lease-Sweep, DB-Sonde (SELECT 1), Provider-Status-Sonden (jeden 5. Tick), Zählung unterbrochener Missionen (nur Anzeige, Neustart bleibt freigabepflichtig), Elite-Metriken. 24/7-Semantik: RUNNING wird nach Prozessneustart fortgesetzt; init() ist im Server-Startup verdrahtet (vorher toter Code). SSE /api/controller/stream ist gemountet und streamt state-/tick-Events; agent.setState startet/stoppt den Watchdog mit; Controller-UI zeigt eine Live-Karte (Ticks, DB, Provider, unterbrochene Missionen, Erfolgsquote). 7 neue Watchdog-Tests (475 grün), Commit 9bd1299, CI + APK success. |
| 066     | Grün    | HITL-Verknüpfung Watchdog → Elite Mission Control: die Watchdog-Karte der Controller-Seite verlinkt unterbrochene Missionen ab Anzahl > 0 direkt zur Prüfung und Freigabe in /core/elite ("Nach Prüfung erneut starten" bleibt an acknowledgeExternalChanges gebunden); der Watchdog zählt und verlinkt nur, ein Neustart bleibt niemals automatisch. |
| 067     | Grün    | Synchronisationskonflikte (Roadmap 066): gescheiterte Chat-Sendungen bleiben sichtbar UND wiederholbar — Nutzer-Nachricht wird „failed“ markiert, behält ihren Text und trägt einen „Erneut senden“-Button, der genau diesen Zug (Nachricht + Folgefehlerantworten) entfernt und neu sendet (client/src/lib/chatSync.ts, rein + 14 Tests). Gescheiterte Verlauf-Persistenz markiert den Zug als „Nur auf diesem Gerät — beim nächsten Laden nicht mehr verfügbar“ statt still zu divergieren; beim Serverabgleich gewinnt der Server, aber der Konflikt ist vorher lesbar. |
| 068     | Grün    | Touch-Zielgrößen (Roadmap 067): alle interaktiven Ziele erreichen jetzt mindestens 44x44px effektive Trefferfläche — Icon-Buttons 40px visuell + unsichtbare ::after-Hit-Area (+4px je Seite, Überlappungsfreiheit durch angehobene Header-Lücke 8px), Bewertungs-Buttons 32px + 6px Expansion (Lücke 8→12px), Chat-einklappen-Button (vorher nacktes 18px-Icon) auf 44x44, Runde-Hinzufügen-Taste 42→44, Mic/Send mobil 43→44, Retry-Button (Sprint 067) 32→44. Neue statische CSS-Regression (touchTargets.test.ts, 8 Tests) pinnt alle Invarianten gegen unbemerktes Schrumpfen — Sprint 061 hatte nur manuell geprüft. |
| 069     | Grün    | Fehler- und Ladezustände (Roadmap 068): Kein Flow endet mehr leer oder blockiert — neue reine Phasenlogik queryFlow.ts (loading/error/ready; deaktivierte Abfragen sind bewusst „ready“, kein Endlos-Spinner vor Login) + QueryState-Komponente mit sichtbarem Ladehinweis und Fehlerkarte mit „Erneut laden“. Integriert an vier stillen Stellen: Elite-Mission-Villenkarte (Fehler statt stiller „wird geladen …“-Leere), Missionsliste und Demoanfragen (Fehler mit Retry statt reinem Text), Controller (Status-Fehler zeigt eigene Retry-Karte statt still deaktivierter Seite), Chat-Verlauf (Ladefehler mit Retry statt verschwundener Historie). 9 neue Logik-Tests (506 grün); Touch-Target-Regression gegen versehentliche Zusatzselektoren gehärtet. |
| 070     | Grün    | Mobile Accessibility (Roadmap 069): Globaler Tastatur-Fokus-Ring für ALLE interaktiven Elemente (:where(button, a, select, textarea, [tabindex]):focus-visible, Cyan #37dcc6 mit >= 3:1 gegen den Hintergrund — vorher nur Sende-/Google-Buttons und Links). Bestandsaufnahme bestätigt: alle Icon-Buttons tragen bereits aria-label, aria-live-Regionen existieren im Chat, prefers-reduced-motion deckt (seit 063) alle Animationen ab, alle 8 Kern-Textpaare erreichen WCAG AA (4.75–16.9:1). Neue statische Regression a11y.test.ts (12 Tests) pinnt Kontrastpaare, Fokus-Ring und Icon-Label-Invariante gegen unbemerkte Regressionen. |
| 076–084 | Teilweise offen (078–080, 084 Login-E2E) | Sprints 076–084 bearbeitet. Strukturierte Logs, pro-Villa-/Projekt-Metriken und Daten-Review (078–080) sowie echte Login-Abdeckung im E2E-Pfad (084) bleiben offen; die übrigen aufgeführten Bereiche sind umgesetzt und verifiziert. |
| 085     | Grün    | End-to-End-Smoke-Suite: 10 deterministische E2E-Tests in tests/e2e/smoke.test.ts prüfen gegen lokal gebooteten Server (Mock-Umgebung, dynamischer Port) den Kernpfad (Health, Routing-Status, Villa-Anlegen inkl. Validierung, Lauf-Start idempotent, Lauf-Stopp, Laufbericht, Isolation). Ausführbar per pnpm test:e2e; 10/10 grün in 1,6 s. |
| 086     | Grün    | Router-Lasttest mit Mock-Providern: Provider-Kette unter paralleler Mock-Last (50 Turns mit Fake-Latenzen), SLO-Grenzwerte als Constants im Logic-Modul (ROUTER_SLO_LIMITS), Cooldown/Failover unter Last stabil, keine Timer-/Listener-Leaks. 8/8 Stresstests grün in 1,2 s. |
| 087     | Grün    | Fehler-Injection: Harness (server/fault-injection.ts) mit Sprint-008-Fehlerklassen + PersistenceError, Anbindung an callWithProviderChain und DB-Probes; 22 Regressionstests, Fehlerklassen sauber getrennt. Nachgeliefert aus geschlossenem #91. |
| 088     | Grün    | Build-Reproduzierbarkeit: PR #92 (scripts/build-manifest.ts, pnpm build:manifest, 11 Tests). Repro-Nachweis via Doppel-Build verifiziert: 100 % identische Artefakt-Hashes (Aggregat-Hash 2cd39f7a...). Doku in docs/TESTING.md. |
| 089     | Grün    | Release-Checkliste: docs/RELEASE.md (SemVer, Drizzle-Migrationen, Rollback, Monitoring, Render-Deploy + Recovery-Route) + scripts/release-check.sh (check+test+build) + 3 Tests grün. |
| 090     | Grün    | Rollback-Test: Checkpoint-Tags (release-NNN), Verifikationsskript scripts/rollback-verify.sh, server/rollback-check.ts (Health-Invarianten, Router-Config, Migrationen), Checkpoint-Tool scripts/rollback-checkpoint.ts, 45 Tests grün. |
| 091–098 | Grün | 091 Freigaben/Vorlagen, 092 Release-Review, 093 Projekt-Dashboard, 094 Kennzahlen, 095 Erweiterungspunkte, 096 Administrator-Handbuch, 097 Nutzer-Onboarding (Abschnitte unten). |
| 098 | Grün | 098 Produkt-Telemetrie (Opt-in) erledigt; 099–100 geplant. |

## Sprint 086 — Router-Lasttest mit Mock-Providern (06.10.2026)

Router-SLO-Spezifikation und deterministischer Stresstest der Provider-Kette unter paralleler Mock-Last:
- **Logic-Modul (server/agent-router.ts)**:
  - `ROUTER_SLO_LIMITS` als explizit exportierte Konstanten definiert:
    - `maxConcurrentTurns`: 50 parallele Turns
    - `p95LatencyMaxMs`: 1500 ms (P95-Grenzwert)
    - `maxLatencyMs`: 3000 ms (P100 / Max-Grenzwert)
    - `maxUncontrolledErrorRatePercent`: 0 % (0 unkontrollierte Abstürze)
    - `maxTelemetrySamples`: 200 Samples
    - `minFailoverSuccessRatePercent`: 100 %
- **Test-Suite (server/router-stress.test.ts)**:
  - (1) Exportierte SLO-Grenzwerte im Logic-Modul verifiziert (`ROUTER_SLO_LIMITS`).
  - (2) 50 parallele Turns unter deterministischer Fake-Latenz (10–30 ms per Turn): P95-Latenz ~25 ms (SLO < 1500 ms), Max-Latenz ~30 ms (SLO < 3000 ms), 100 % Erfolgsquote.
  - (3) Cooldown/Failover unter Last: Bei 429 Rate-Limit auf OpenRouter schaltet der Router sofort in den Cooldown; 50/50 parallele Folge-Turns laufen direkt über den Groq-Fallback mit 100 % Erfolgsquote und überspringen gesperrte Provider ohne unnötige HTTP-Anfragen.
  - (4) Dichtigkeits- und Leak-Prüfung: Keine neuen `process`-Listener (`uncaughtException`, `unhandledRejection`), `liveProgress`-Map und Cooldowns bereinigt, Telemetrie-Speicher strikt auf 200 Samples gedeckelt.
- **Ergebnis**: 8/8 Router-Stresstests grün in ~1.2 s (`pnpm test server/router-stress.test.ts`), vollständige Testsuite (628 Tests in 77 Testdateien) grün.

## Sprint 089 — Release-Checkliste & Release-Skript (07.10.2026)

Vollständige Release-Dokumentation in `docs/RELEASE.md` und automatisches Release-Prüfskript `scripts/release-check.sh`.

- **Release-Dokumentation (`docs/RELEASE.md`)**:
  - **Versionsschema**: SemVer (`MAJOR.MINOR.PATCH`), Single Source of Truth in `package.json`, dynamische Auslesung über `/api/health`, Release-Tags `release-NNN` und `vX.Y.Z`.
  - **Migrations-Schritte**: Drizzle ORM (`drizzle-kit`), Neon PostgreSQL, `pnpm db:push`, Pre-/Post-Deploy-Prüfungen.
  - **Rollback-Weg**: Git Code Rollback, Render Deploy Rollback, strikte Regel: keine automatischen DB-Schema-Rollbacks ohne getestete Abwärtsmigrationen.
  - **Monitoring-Checks**: `/api/health` Payload-Spezifikation (ok, version, database, controller, providers, routing), Metriken & Telemetrie.
  - **Render-Deploy-Flow & Recovery**: `render-restore.yml` Workflow, strikte Regel für Render-Env-Variablen (NIE per partiellem Bulk-PUT überschreiben!).
- **Release-Check-Skript (`scripts/release-check.sh`)**:
  - Ausführbares Bash-Skript mit Exit-Code 0/1.
  - Führt nacheinander `pnpm check`, `pnpm test` und `pnpm build` aus.
  - Formatierte Zusammenfassung aller drei Teilschritte.
  - Eingebunden als `pnpm release:check` in `package.json`.
- **Test-Suite (`tests/release-check.test.ts`)**:
  - 3 Unit-Tests verifying Executable-Rechte, Content/Commands und `package.json`-Einbindung.

## Sprint 090 — Rollback-Test (07.10.2026)

Dokumentierter, deterministisch getesteter Rollback-Pfad mit Checkpoint-Tags, Invarianten-Prüfung und Artefakt-Restore.

- **Lieferumfang**:
  - `server/rollback-check.ts`: Deterministische Prüflogik für Health-Invarianten (ok=true, SemVer, DB verbunden, activeRoute, betriebsbereite Provider), Router-Config-Persistenz (`data/route-override.json` lesbar & valides JSON) und Abwärtskompatibilität von Schema-Migrationen (additive/nullable Spalten).
  - `server/rollback-check.test.ts`: 33 deterministische Unit-Tests für Invarianten-, Tag- und Kompatibilitätsprüfungen.
  - `scripts/rollback-checkpoint.ts`: CLI- & Bibliotheks-Tool zum Erstellen (`create`), Validieren (`verify`) und Wiederherstellen (`restore`) von Artefakt-Checkpoints mit SHA-256 Aggregat-Hashes und Manifest-Erzeugung.
  - `tests/rollback-checkpoint.test.ts`: 12 Unit-Tests für Checkpoint-Erstellung, Manipulation Erkennung, zielgenaue Wiederherstellung und Idempotenz.
  - `scripts/rollback-verify.sh`: Ausführbares Verifikationsskript, das Git-Ahnen-Status, Health-Invarianten und pnpm check/test/build für einen Stand prüft.
  - `docs/RELEASE.md`: Abschnitt 3 („Rollback-Weg“) um konkrete Schritte, Skript-Aufrufe, Invarianten-Regeln und DB-Migrationsrichtlinien erweitert.
- **Richtlinien & Regeln**:
  - Rollback stellt den Quell-Zustand inklusive Dateilisten und SHA-256 Prüfsummen exakt wieder her.
  - Gemäß `docs/BRANCH-PROTECTION.md` & `docs/RELEASE.md` werden DB-Migrationen nie automatisch rückwärts ausgeführt. Die Richtlinie ist im Checkpoint-Manifest verankert.
- **Tests**: 45 Rollback-Unit-Tests grün (672 passed gesamt).

## Sprint 090 — Rollback-Test (08.10.2026)

Dokumentierter und getesteter Rollback-Pfad mit Checkpoint-Tags, Verifikationsskript und deterministischer Invarianten-Pruefung.

- **Lieferumfang**:
  1. `server/rollback-check.ts`: Logic-Modul mit `parseCheckpointTag()`, `isSafeRollbackTarget()`, `verifyHealthInvariants()`, `verifyMigrationsBackwardCompatible()`, `verifyRouterConfigPersistence()`, `fullRollbackCheck()`.
  2. `server/rollback-check.test.ts`: 25 deterministische Tests (Tag-Parsing, Checkpoint-Sicherheit, Health-Invarianten, Migrationen, Router-Config, Full-Check).
  3. `scripts/rollback-verify.sh`: Verifikationsskript, das Git-Existenz, Ancestor-Relation, check/test/build prueft.
  4. `docs/RELEASE.md`: Neue Abschnitte G (Checkpoint-Tags) und H (Router-Config-Persistenz).
  5. `package.json`: `pnpm rollback:verify` registriert.
  6. Checkpoint-Tag `release-089` auf main.
- **Invarianten**: ok=true, SemVer-Version, database=verbunden, activeRoute!=null, mind. 1 Provider nutzbar, Migrationen abwaertskompatibel, Router-Config lesbar/valid.
- **Tests**: 25 neue Tests, bestehende Tests unveraendert.
- **Grenzen**: Logic-Modul operiert auf uebergebenen Daten (keine echten Git/Health-Aufrufe); Skript macht echte Git/pnpm-Aufrufe.

## Sprint 091 — Release-Review (08.10.2026)

Release-Review mit Statusmatrix aller Roadmap-Bereiche 1-9 und Sicherheits-Checkliste.

- **Review-Dokument (`docs/RELEASE-REVIEW.md`)**:
  - Statusmatrix für alle 10 Roadmap-Bereiche (1-9 plus Bereich 10-Überblick) mit Status (Grün/Teilweise offen), Zusammenfassung und Beweisverweisen auf Code-Dateien und Tests.
  - Bereich 1-7 und 9: Vollständig grün.
  - Bereich 8 (Daten, Persistenz, Beobachtbarkeit): Sprints 071-077 grün, Sprints 078-079 (strukturierte Logs, Metrik-Dashboard) ehrlich als teilweise offen markiert mit Empfehlung, vor Release 1.0 nachzuziehen.
  - Sicherheits-Checkliste: Kein Limit-Bypass, kein Passwort-Login, Admin-Mutationsschutz (Admin-Rolle oder AGENT_ADMIN_EMAIL), RLS/Ownership, Provider-Grenzen, keine Secrets, Rate-Limit, CSRF-Schutz — alle Grün mit Beweisverweisen.
  - Test-Übersicht: ~672 Tests gesamt, alle Grün.
- **Regressionstest (`tests/release-review.test.ts`)**:
  - 6 deterministische Tests: Dokument-Existenz, Statusmatrix-Vollständigkeit (alle 9 Bereiche), offene Punkte ehrlich markiert, SPRINT-STATUS.md-Referenz, Sicherheits-Checkliste, Test-Übersicht.
- **Tests**: 6 neue Release-Review-Tests, bestehende Tests unangetastet.
- **Offene Punkte**: Bereich 8 Sprints 078-079 (strukturierte Logs, Metrik-Dashboard) vor Release 1.0 nachziehen.

## Sprint 091 — Projektvorlagen (09.10.2026)

Häufige Agentenprojekte können als sichere Vorlage angelegt werden.

- **Lieferumfang**:
  1. `server/templates.ts`: Vorlagendefinitionen (`VILLA_TEMPLATES`) mit 5 Vorlagen (Code-Review, Recherche, Brainstorming, Dokumentation, Test-Automatisierung), Validierungsfunktion (`validateTemplate`), Suche (`findTemplate`) und Konvertierung (`templateToVillaInput`).
  2. `server/villa-store.ts`: `createVillaFromTemplate()` nutzt dieselbe `createVilla`-Funktion, sodass Limits und Audit-Spur identisch sind.
  3. `server/villa-router.ts`: tRPC-Endpunkte `villa.templatesList` (Query) und `villa.createFromTemplate` (Mutation, protected).
  4. `server/templates.test.ts`: 17 deterministische Tests (Vorlagen-Vollständigkeit, Kapazitätsgrenzen, Icon-Validierung, Limit-Bypass-Ausschluss, Validierung, Suche, Konvertierung).
- **Sicherheitsgrenzen**: Keine Vorlage enthält `limit-bypass` oder ähnliches (AGENTS.md-Regel, von `agent-villa.test.ts` geprüft). Kapazität 1–25 (Sprint 012). `validateTemplate` prüft alle Felder beim Modul-Laden.
- **Tests**: 17 neue Tests, bestehende Tests unangetastet.


## Sprint 078 — Strukturierte Logs (10.10.2026)

Jede HTTP-Zugriffslogzeile ist jetzt eine maschinenlesbare JSON-Zeile mit Korrelations-ID, Status und Dauer (Roadmap 078).

- **`server/structured-log.ts` (neu)**:
  - `structuredLog(level, event, fields)`: eine JSON-Zeile mit `ts`, `level`, `event` und sicher bereinigten Feldern.
  - Sicherheitsinvarianten: Felder mit geheimnisverdächtigen Namen (secret/token/key/password/authorization/cookie) werden verworfen, Werte über 500 Zeichen gekürzt — keine Prompts, Nutzdaten oder Geheimnisse in Logs.
  - `newCorrelationId()`: kompakte, nicht vorhersagbare 12-Hex-ID; `startCorrelation()` für Zeitmessungen.
- **`server/_core/request-logger.ts` (umgestellt)**:
  - Zugriffslog als `http_request`-JSON-Zeile (früher: formatierter Text) mit `correlationId`, `method`, `path` (ohne Query), `status`, `durationMs`. Health-Checks bleiben still.
  - Die Korrelations-ID wird als `X-Request-Id`-Antwortkopf zurückgegeben; Supportmeldungen lassen sich eindeutig einer Logzeile zuordnen.
  - Unbehandelte Fehler loggen als `unhandled_request_error`-JSON-Zeile und antworten mit `{ error, requestId }` — weiterhin ohne Interna nach außen.
- **Tests**: 9 neue/erweiterte Tests (structured-log.test.ts, request-logger.test.ts): JSON-Parsbarkeit, Frische Korrelations-IDs pro Request, Geheimnis-Verwurf, Kürzung, Health-Silence, Header-Sent-Wahrung. Suite: 736 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 079 — Metrik-Dashboard: pro Villa und Projekt filterbar (10.10.2026)

Kernmetriken (Laufzeit, Ergebnisstatus, Fehlercodes) sind jetzt pro Villa und Projekt filterbar (Roadmap 079).

- **`server/agent-metrics.ts` (erweitert)**:
  - Jeder Lauf trägt jetzt `villaId` und `project` ("owner/repo"; jeweils null bei serverweiten Läufen).
  - `agentMetricsSummary(filter?)`: filtert nach `villaId` und/oder `project`; ohne Filter bleibt die globale Übersicht unverändert.
  - `agentMetricsScopes()` (neu): jede bekannte Villa/Projekt-Kombination mit eigener aggregierter Kernmetrik (Totals, mittlere Laufzeit, Samples), absteigend sortiert — Datenbasis für das Dashboard.
  - `instrumentAgentRun(kind, isComplete, run, scope?)` reicht den Scope in Erfolgs- UND Fehlerpfad durch; bestehende Aufrufer bleiben kompatibel.
- **`server/agent-router.ts`**: Elite-Missionsläufe erfassen `villaContext.villaId` und `villaContext.repository` als Scope; der Admin-Endpunkt `agentMetrics` akzeptiert optionale Filter `{ villaId?, project? }` und liefert zusätzlich `scopes` mit.
- **Tests**: 7 neue Tests (agent-metrics.test.ts, agent-router.test.ts): Scope-Erfassung, Filter nach Villa/Projekt/Kombination, Scope-Übersicht, Fehlerpfad-Durchreichung, Endpunkt inkl. Admin-Gate. Suite: 743 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 080 — Daten-Review (10.10.2026)

Persistenz-, Health- und Logpfade sind gebündelt geprüft und dokumentiert (Roadmap 080).

- **`server/data-review.test.ts` (neu, 10 Tests)**: gebündelte Regressionssuite für die drei Betriebspfade:
  - Persistenz: ehrliche Schreibfehler (`DATABASE_UNAVAILABLE`, openId-Validierung), saubere Lese-Degradation, DB-Sonde verbunden/fehler/nicht_konfiguriert.
  - Health: Payload-Struktur (`ok`, SemVer-Version, providers, routing), kein Secret-Muster im Payload, DB-Status als reine Cache-Durchreichung, Route antwortet 200.
  - Logs: Zugriffs- und Fehlerlogzeilen als JSON mit Korrelation/Status/Dauer, requestId in der 500-Antwort ohne Interna, Geheimnis-Verwurf.
- **`docs/DATA-REVIEW.md` (neu)**: Soll-Zustand, Invarianten-Tabellen und Verifikationskommandos je Pfad.
- Suite: 753 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 084 — Echte Login-Abdeckung im E2E-Pfad (10.10.2026)

Der E2E-Smoke deckt jetzt den echten Login-Pfad ab: Login, Villa, Lauf und Bericht werden mit eigener Session durchlaufen (Roadmap 084).

- **`tests/e2e/smoke.test.ts` (erweitert, 10 → 13 Tests)**:
  - Der SDK-Auth-Mock validiert jetzt echte Session-Token (Bearer): fehlender Token → anonym (null), ungültiger Token → INVALID_SESSION, gültiger Token → Nutzer-Auflösung — wie im echten Base44-SDK. Der Standard-Client sendet seinen Session-Token explizit.
  - Test 11: ohne Session-Token ist man anonym; öffentliche Prozeduren (`auth.me`) melden null, geschützte Prozeduren antworten sauber UNAUTHORIZED (kein 500).
  - Test 12: ungültige Session wird wie anonym behandelt — gleiche UNAUTHORIZED-Grenze.
  - Test 13: Login-Vollpfad mit eigener Session (User 18): Login → Villa erstellen → Lauf starten → Lauf stoppen → Bericht abrufen, alles unter einem durchgehenden login-geschützten Pfad inkl. Nutzer-Isolation.
- Suite: 756 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 092 — Rollenbasierte Dashboards (10.10.2026)

Dashboard-Inhalte passen sich der Rolle an; die sichtbaren Abschnitte sind zentral definiert und der Client fragt sie beim Server ab (Roadmap 092).

- **`server/dashboard.ts` (neu)**: zentrale Abschnittsdefinition (`villa_overview`, `token_budget`, `onboarding` für Viewer; `villa_mission`, `controller` ab Operator; `elite_mission`, `admin_metrics`, `routing`, `provider_config` ab Administrator) mit stabiler Render-Reihenfolge und reiner Layout-Berechnung `dashboardLayoutForRole`.
- **tRPC-Endpunkt `agent.dashboard`**: liefert Rollen-Layout über `resolveAgentRole` — Single Source of Truth statt Client-Ratrerei.
- **`server/dashboard.test.ts` (neu, 7 Tests)**: Viewer sehen nie Operator-/Admin-Inhalte, Operatoren nie Admin-Inhalte, Admins alles; Operator-Allowlist hebt das Layout korrekt; Endpunkt spiegelt die Rolle.
- **Client (`Home.tsx`)**: alle 17 Rollen-Gates leiten sich aus `agent.dashboard` ab (Fallback auf `statusQuery`, solange das Layout lädt).
- Suite: 763 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.
- Hinweis: tRPC-v11-Caller ruft Prozeduren direkt auf (`caller.agent.dashboard()`), nicht mit `.query()` — sonst resolution-Fehler.


## Sprint 093 — Mehrsprachigkeit vorbereiten (10.10.2026)

UI-Texte sind zentral und übersetzbar organisiert (Roadmap 093). Deutsche Texte bleiben Referenz; erste Zielsprache Englisch.

- **`client/src/lib/i18n.ts` (neu)**: flacher, zentraler Textkatalog (`messages.de`/`messages.en`, Schluesselkonvention `bereich.text`), `translate()` mit Platzhalter-Ersetzung und de-Fallback, Locale-Erkennung (Speicher > Browsersprache > Standard de), Private-Modus-tolerante Speicherfunktionen.
- **`client/src/lib/i18n.test.ts` (neu, 7 Tests)**: Vollständigkeit (jeder de-Schluessel in jeder Sprache), flache eindeutige Schluessel, Fallback-Verhalten, Platzhalter, Locale-Guards, Speicher-/Browsererkennung.
- **`client/src/contexts/I18nContext.tsx` (neu)**: `I18nProvider` + `useI18n()` mit app-weiter Sprachwahl und Browser-Speicherung; in `App.tsx` eingehängt.
- **Mustermigration**: `TokenBudgetWidget` nutzt als erste Komponente vollständig den Katalog (`budget.*`), inkl. längeabhängiger Zeitformatierung (`de-DE`/`en-US`).
- Folgearbeit (ausserhalb dieses Sprints): weitere Komponenten auf den Katalog umstellen — der Katalog ist die zentrale Anlaufstelle, neue UI-Texte werden dort gepflegt.
- Suite: 770 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 094 — Theme-System stabilisieren (10.10.2026)

Alle vier Themes (midnight/paper/terminal/sunset) teilen denselben Kern-Design-Token-Satz; Kernflächen ziehen ihre Farben nur noch aus Tokens (Roadmap 094).

- **Token-Layer in `styles/themes.css`**: Abschnitt 0 definiert je Theme 29 Kern-Tokens (`--vf-header-*`, `--vf-btn-*`, `--vf-chip-*`, `--vf-bubble-*`, `--vf-send-*`, `--vf-author-text`, `--vf-row-*`, `--vf-drawer-*`, `--vf-tabbar-*`, `--vf-modal-*`). Werte stammen 1:1 aus den bisherigen Regeln — das Erscheinungsbild ändert sich nicht.
- **52 Kernregeln migriert**: Header, Icon-Buttons (inkl. Hover/Active), Suggestion-Chips, Nachrichten-Bubbles (inkl. eigene), Send-Button, Autorenfarbe, Villa-Zeilen (inkl. Hover/Selected), Drawer, Mobile-Tabbar, Villa-Modal je Theme auf `var(--vf-*)` umgestellt. Struktur-Eigenschaften (Rahmenbreiten, Radien, Schriften, Schatten) bleiben themen-eigene Regeln.
- **`client/src/lib/theme-tokens.test.ts` (neu, 4 Tests)**: Vollständigkeit des Kern-Token-Satzes je Theme, jede `var(--vf-*)`-Referenz definiert, Kernregeln nutzen Tokens, Token-Werte unterscheiden sich je Theme.
- Suite: 774 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 095 — Erweiterungspunkte (10.10.2026)

Neue Provider, Packs und Phasen können ohne Kernumbau ergänzt werden (Roadmap 095).

- **Provider-Registry (`server/_core/llm-router.ts`)**: `registerLLMProvider()` meldet neue Anbieter an (reine Daten; gleichnamige Registrierung aktualisiert statt zu verdoppeln). Die Namens-Sonderfälle des Fallback-Loops sind Provider-Hooks geworden: `buildUrl` (Gemini-Query-Key) und `quiet` (Forge-Logging) — der Kern ist generisch. `resetLLMProvidersForTests()` für saubere Tests.
- **Phasen-Register (`server/mission-strategies.ts`, neu)**: OPTIMIZE/REBUILD liegen in einem Register; tRPC-Schema (`missionStrategySchema`), Analyse-Prompt (`strategyChoicePrompt()`) und Empfehlungs-Parser (`parseStrategyRecommendation()`) werden daraus abgeleitet. agent-router.ts nutzt nur noch das Register — eine neue Phase ist ein reiner Registereintrag.
- **Pack-Katalog (`server/pack-catalog.ts`)**: `buildPackCatalog(packs, authority)` als reine Funktion; neue Packs brauchen nur CAPABILITY_PACKS- plus Authority-Eintrag. Fehlende Katalogisierung wirft weiterhin ehrlich.
- **`server/extension-points.test.ts` (neu, 8 Tests)**: neuer Provider läuft ohne Kernumbau im Fallback (inkl. eigener URL-Konstruktion), Update-Registrierung, Reset; Schema/Prompt/Parser konsistent aus einem Register, nur registrierte Strategien gelten; neue Packs katalogisierbar, fehlende Authority wirft, Produktiv-Katalog vollständig.
- Suite: 782 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 096 — Administrator-Handbuch (10.10.2026)

Betrieb, Grenzen und Notfallstop sind dokumentiert (Roadmap 096).

- **`docs/ADMIN-HANDBUCH.md` (neu)**: Betrieb (Deployment-Verweise, Server-Secrets, Provider-Fallback mit Cooldown, Watchdog), Grenzen (Elite-Limits, GitHub-Schreibgrenzen, Freigabepunkte, Audit/Metriken) und Notfallstop (`agent.setState` mit `acknowledgeStop`-Quittung, Wirkung/Nicht-Wirkung, Eskalations-Kurzliste).
- **`server/admin-handbook.test.ts` (neu, 7 Tests)**: hält das Handbuch ehrlich gegen den Code — jede env.ts-Variable dokumentiert, echte Zustände/Mutationen, Elite-Limits mit echten Zahlen, GitHub-Grenzen, referenzierte Dokumente existieren wirklich, Provider-Reihenfolge korrekt. Driftet der Code, fällt der Test.
- Suite: 789 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` grün.


## Sprint 097 — Nutzer-Onboarding (10.10.2026)

Neue Nutzer koennen eine Villa ohne Sackgasse erstellen (Roadmap 097).

- **`client/src/lib/villa-onboarding.ts` (neu)**: `normalizeRepositoryInput()` verzeiht eingeklebte GitHub-URLs (https://, www., .git, Trailing-Slashes) und haelt das Server-Format `owner/repo` ein; `validateNewVillaForm()` prueft Name/Projektidee/Beschreibung/Repository vor dem Absenden mit klaren deutschen Meldungen; `onboardingSteps()` nennt fuer eine frische Villa den naechsten sinnvollen Schritt.
- **Home.tsx verdrahtet**: Live-Feldfehler im Erstellungs-Modal (inkl. „Wird verbunden als ..."-Vorschau der Normalisierung), Submit blockiert mit klarer Meldung statt Server-Zod-Fehler, Onboarding-Toast direkt nach der Erstellung und persistenter „Naechste Schritte"-Hinweis in der Villa-Stage, solange Projektziel oder Repository fehlen.
- **`client/src/lib/villa-onboarding.test.ts` (neu, 10 Tests)**: Normalisierungsfaelle, ehrliche Ablehnung (Gitlab-URLs, einName), Minimalformular okay, klare Fehlermeldungen statt Sackgasse, Onboarding-Schritte je Villa-Zustand.
- Suite: 797 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` gruen.


## Sprint 098 — Produkt-Telemetrie, optional und datenschutzkonform (10.10.2026)

Nur datenschutzkonforme, optionale Metriken werden erhoben (Roadmap 098).

- **Opt-in statt Stillstand**: Neue Tabelle `telemetry_consents` (Migration `0016_deep_paper_doll.sql`), Standard AUS. `server/telemetry-consent.ts` liefert Zustand + ehrlichen Datenschutzhinweis; ohne DB gilt konservativ „nicht eingewilligt“ (Telemetrie faellt im Zweifel aus, nie an).
- **tRPC**: `telemetry.consent` / `telemetry.setConsent` (`server/telemetry-router.ts`), registriert in `routers.ts`.
- **Gate am Lauf**: `executePersistedMission` laedt die Einwilligung des Missions-Besitzers und reicht sie an `instrumentAgentRun(..., telemetryEnabled)` weiter — ohne Einwilligung werden keine Laufmetriken erfasst, der Lauf laeuft unberuehrt.
- **UI**: Schalter im Villa-Drawer (`Home.tsx`, CSS in `themes.css`) mit ungekuerztem Hinweis am Schalter; Aenderung wirkt sofort.
- **Doku**: `docs/TELEMETRIE.md` — Produktmetriken (Opt-in, nur Zahlen, max. 200 In-Memory) vs. Betriebsmetriken (Router-Telemetrie/Turn-Usage, rein technisch); nie erhoben: Inhalte, Prompts, personenbezogene Daten, Geheimnisse; kein Export.
- **Tests**: `telemetry-consent.test.ts` (Router: Zustand, Standard AUS, Store-Weitergabe, SERVICE_UNAVAILABLE-Fallback), `telemetry-consent-store.test.ts` (DB-Ausfall = konservativ AUS, Hinweis-Grenzen), `agent-metrics.test.ts` (telemetryEnabled=false erfasst nichts; Integrationstests simulieren erteilte Einwilligung).
- Suite: 805 passed / 4 skipped. `tsc --noEmit` sauber, `pnpm build` gruen. Deployment-Hinweis: `pnpm db:push` fuer die neue Tabelle.
