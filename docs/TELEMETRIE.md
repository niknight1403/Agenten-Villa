# Produkt-Telemetrie (Sprint 098)

Die Agenten-Villa erhebt nur datenschutzkonforme, **optionale** Metriken.
Dieses Dokument beschreibt ehrlich, was erhoben wird, was niemals erhoben
wird, wo Daten liegen und wie Nutzer die Erhebung steuern.

## Zwei Klassen von Metriken

### 1. Produktmetriken (Opt-in, Standard AUS)

Was bei Einwilligung je Agentenlauf erfasst wird — nur Zahlen:

| Feld | Inhalt |
| --- | --- |
| `kind` | Laufart (Elite-Mission bzw. Neustart) |
| `outcome` | Ergebnisstatus (`completed` / `partial` / `failed`) |
| `durationMs` | Dauer in Millisekunden |
| `errorCode` | TRPC-/Fehlercode bei Misserfolg, sonst null |
| `finishedAt` | ISO-Zeitstempel |
| `villaId` / `project` | Villa- und Projektlabel (`owner/repo`) |

**Speicherung:** ausschließlich im Prozessspeicher, begrenzt auf die letzten
200 Einträge (kein Export an Dritte, kein Schreiben in die Datenbank).

### 2. Betriebsmetriken (immer an, rein technisch)

- Router-Telemetrie (Sprint 038): Latenz, Erfolg, Fallback-Grund —
  pro Anbieter/Modell, prozesslokal. Notwendig für Failover, Cooldown und
  Fehlersuche.
- Turn-Nutzung (Sprint 077): Token-Zahlen für das Budget-Widget,
  prozesslokal.

Beide enthalten keinerlei Nutzerinhalte: keine Chatverläufe, keine Prompts,
keine Antworten, keine personenbezogenen Daten, keine Geheimnisse.

## Einwilligung (Consent)

- Pro Nutzer persistiert in der Tabelle `telemetry_consents`
  (`drizzle/schema.ts`, Migration `0016_deep_paper_doll.sql`).
- **Standard: nicht eingewilligt** (opt-in). Ohne Einwilligung werden keine
  Produktmetriken erfasst; der Lauf selbst läuft unberührt.
- Konservativer Fallback: Ohne Datenbank oder bei Store-Fehlern gilt immer
  „nicht eingewilligt“ — Telemetrie fällt im Zweifel aus, nie an.
- Zustand/Änderung: tRPC `telemetry.consent` (Query) und
  `telemetry.setConsent` (Mutation); Schalter im Villa-Drawer der App
  zeigt den ungekürzten Datenschutzhinweis direkt am Schalter.

## Wo das im Code lebt

| Baustein | Ort |
| --- | --- |
| Consent-Store + Hinweistext | `server/telemetry-consent.ts` |
| tRPC-Router | `server/telemetry-router.ts` (registriert in `server/routers.ts`) |
| Opt-in-Gate am Lauf | `server/agent-router.ts` → `instrumentAgentRun(..., telemetryEnabled)` |
| Metrikerfassung (begrenzt) | `server/agent-metrics.ts` |
| UI-Schalter | `client/src/pages/Home.tsx` + `client/src/styles/themes.css` |
| Tests | `server/telemetry-consent.test.ts`, `server/telemetry-consent-store.test.ts`, `server/agent-metrics.test.ts` |

## Betriebs-Sicherheit

- Migration ausführen: `pnpm db:push` (erzeugt/applyiert `0016_deep_paper_doll.sql`).
- Ein Widerruf wirkt sofort: Nach dem Abschalten werden keine neuen
  Laufmetriken erfasst (bestehende In-Memory-Samples verfallen mit dem
  Prozess, spätestens nach 200 weiteren Läufen).
