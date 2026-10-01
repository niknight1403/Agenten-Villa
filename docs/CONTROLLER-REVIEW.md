# Controller-Review (Sprint 030)

Review-Zeitpunkt: 1. Oktober 2026 · Status: **Grün**

Die Laufzustände, Rechte und Regressionstests aus den Sprints 021–029
wurden zusammenhängend geprüft. Ergebnis: konsistent, abgesichert, grün.

## Laufzustände

Zustandsautomat von `villa_test_runs`:

| Zustand     | Bedeutung                      | Übergänge                                     |
| ----------- | ------------------------------ | --------------------------------------------- |
| `running`   | Lauf aktiv                     | → `succeeded`/`failed` (Finish), → `cancelled` (Finish, mit `cancellationKind`) |
| `succeeded` | Erfolgreich abgeschlossen      | terminal, Finish idempotent                   |
| `failed`    | Fehlgeschlagen                 | terminal, freigebbar für Wiederaufnahme      |
| `cancelled` | Abgebrochen                    | terminal, freigebbar für Wiederaufnahme      |

Invarianten (verifiziert):

- Countdown und Fortschritt (Sprint 024) sind deterministische
  Projektionen aus `startedAt` + Zeitgrenze; abgeschlossene Läufe sind
  immer vollständig (100 %).
- Abbruchart (Sprint 026): `manual` (Default) oder `technical`, nur mit
  Status `cancelled`; ein wiederholtes Finish schreibt die Art nie um.
- Wiederaufnahme (Sprint 027): nur aus explizit freigegebenen,
  abgeschlossenen Läufen (`NOT_RELEASED` sonst); der neue Lauf
  referenziert `resumedFromRunId`, der Ursprungslauf bleibt unberührt.
- Laufbericht (Sprint 028): reine Projektion — Status, Dauer, Phase,
  Zeitgrenze, Abbruchgrund, Fehlerbild; kein eigener Speicherzustand.

## Rechte

| Operation                          | Nutzer (Eigentümer) | Fremder Nutzer | Administrator |
| ---------------------------------- | ------------------- | -------------- | ------------- |
| Villas & eigene Läufe starten/führen | ja                | nein (NOT_FOUND) | ja           |
| Laufbericht lesen                  | ja                  | nein (NOT_FOUND) | ja           |
| Wiederaufnahme freigeben           | ja                  | nein (NOT_FOUND) | ja           |
| Globalen Controller-Status lesen   | ja                  | ja             | ja           |
| Controller starten/stoppen/togglen| nein (FORBIDDEN)    | nein (FORBIDDEN) | ja           |

Die Admin-Rolle stammt ausschließlich aus der verifizierten
Authentifizierung; eine selbst deklarierte Angabe gewährt nie Zugriff.

## Regressionstests

- `server/run-lifecycle.regression.test.ts` prüft den gesamten Zeitstrahl
  (Start → Countdown → Zeitgrenze → technischer Abbruch → Freigabe →
  Wiederaufnahme → Bericht) als zusammenhängende Invarianten.
- Rechte-Matrix als Regression: Controller-Steuerungen admin-only,
  fremde Läufe unsichtbar (NOT_FOUND).
- `pnpm validate` grün: TypeScript, Lint und alle Testdateien.
