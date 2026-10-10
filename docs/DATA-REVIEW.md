# Daten-Review (Sprint 080)

Gebündelter Review der drei Betriebspfade: **Persistenz**, **Health** und **Logs**.
Jeder Pfad hat eine pinned Regressionssuite (`server/data-review.test.ts`, 10 Tests) und einen dokumentierten Soll-Zustand. Der Review ist bewusst rein (kein echter Datenbankserver nötig) — die echten Verbindungspfade werden zusätzlich vom E2E-Smoke (`tests/e2e/smoke.test.ts`) gegen einen lokal gebooteten Server geprüft.

## 1. Persistenzpfad

**Soll-Zustand:** Schreibzugriffe scheitern ehrlich mit klaren Fehlern statt still zu siegen; Lesezugriffe degradieren sauber, statt den Prozess zu gefährden.

| Invariante | Verhalten | Test |
| --- | --- | --- |
| `upsertUser` ohne `openId` | wirft klaren Validierungsfehler | `Daten-Review: Persistenzpfad` |
| `upsertUser` ohne Datenbank | wirft `DATABASE_UNAVAILABLE` (kein Schein-Erfolg) | `Daten-Review: Persistenzpfad` |
| `getUserByOpenId` ohne Datenbank | `undefined` + Warnung, kein Absturz | `Daten-Review: Persistenzpfad` |
| DB-Sonde (`probeDatabaseConnection`) | `verbunden` / `fehler` / `nicht_konfiguriert` klar getrennt | `Daten-Review: Persistenzpfad`, `db-health.test.ts` |

Migrationen laufen ausschließlich über Drizzle (`pnpm db:push`); Regeln für Schema-Rollbacks: siehe `docs/RELEASE.md`.

## 2. Health-Pfad

**Soll-Zustand:** `GET /api/health` antwortet immer sofort (200), ohne blockierende Datenbankabfrage und ohne Geheimnisse. Degradation ist im Payload sichtbar, nicht im Statuscode (keine Render-Neustart-Schleife).

| Invariante | Verhalten | Test |
| --- | --- | --- |
| Payload-Struktur | `ok: true`, `version` (SemVer aus `package.json`), `mode`, `uptimeSec`, ISO-`timestamp`, `providers[]`, `routing` | `Daten-Review: Health-Pfad` |
| Keine Secrets im Payload | keine `sk-`/`ghp_`/`hf_`-Muster im serialisierten Payload | `Daten-Review: Health-Pfad` |
| DB-Status als Cache | gesetzt → `database`-Feld sichtbar; ungesetzt → Feld weg; nie blockierend | `Daten-Review: Health-Pfad` |
| Route antwortet 200 | `registerHealthRoute` liefert den Payload mit HTTP 200 | `Daten-Review: Health-Pfad`, E2E-Smoke |

## 3. Logpfad (Sprint 078)

**Soll-Zustand:** Jede Logzeile ist eine maschinenlesbare JSON-Zeile mit Korrelations-ID, Status und Dauer; Geheimnisse und Prompts erreichen nie eine Logzeile; Health-Check-Zugriffe bleiben still.

| Invariante | Verhalten | Test |
| --- | --- | --- |
| Zugriffslog = JSON | `http_request` mit `correlationId`, `status`, `durationMs`, Pfad ohne Query | `Daten-Review: Logpfad`, `request-logger.test.ts` |
| Fehlerlog = JSON + requestId | `unhandled_request_error`; Antwort `{ error, requestId }` ohne Interna | `Daten-Review: Logpfad` |
| Geheimnis-Verwurf | Felder mit `secret/token/key/password/authorization/cookie` im Namen werden verworfen | `Daten-Review: Logpfad`, `structured-log.test.ts` |
| Korrelation nach außen | `X-Request-Id`-Antwortkopf für Supportzuordnung | `request-logger.test.ts` |

## Verifikation

```bash
pnpm test server/data-review.test.ts   # 10/10 grün
pnpm test:e2e                           # E2E-Smoke gegen lokalen Server
pnpm release:check                      # check + test + build gesamt
```

Reviewed am 2026-10-10 (Sprint 080). Änderungen an Persistenz-, Health- oder Logpfaden müssen die Suite grün halten.
