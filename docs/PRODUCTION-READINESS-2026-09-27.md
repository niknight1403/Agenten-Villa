# Agenten Villa: Produktionsprüfung (27. September 2026)

## Geprüfter Stand

Ausgangspunkt ist PR #17 auf `agent/mobile-villa-storage-manager` (Commit
`3c7b7e4`). Der letzte GitHub-Lauf hatte eine grüne Web-CI und einen roten
Android-Smoke-Job. Dessen Screenshot zeigte den Villen-Startbildschirm hinter
dem Android-Systemdialog „Quickstep isn't responding“; der UI-Texttest konnte
daher die Oberfläche nicht erkennen. Der APK-Build war erfolgreich. Der neue
Smoke-Test erkennt den Dialog, wählt „Wait“ und prüft anschließend sichtbaren
Text per UIAutomator und Screenshot-OCR.

## Korrigierte Befunde

| Bereich | Befund | Änderung |
| --- | --- | --- |
| Persistenz | `rowsAffected` und `insertId` waren MySQL-Annahmen in einem PostgreSQL-Projekt. Villa-Update/-Löschen und Verlaufsspeicherung lieferten falsche Ergebnisse. | `RETURNING` für Update, Delete und Insert; Löschen von Villa und Nachrichten in einer Transaktion. |
| Anmeldung | Ein Google-Profil mit nicht verifizierter E-Mail konnte über `AGENT_ADMIN_EMAIL` Admin werden. | Admin-Zuweisung verlangt `email_verified`; nicht verifizierte Konten verlieren eine zuvor so erlangte Rolle beim Login. |
| Datenbankfehler | `upsertUser` meldete bei fehlender DB Erfolg, obwohl keine Sitzung angelegt werden konnte. | Fehler wird an den Anmeldepfad weitergegeben. |
| Leistung | Jede API-Authentifizierung schrieb `lastSignedIn` erneut in die DB. | Anmeldung schreibt den Zeitpunkt; reguläre API-Anfragen lesen nur den Nutzer. |
| Rate-Limit | Ein frei setzbarer `X-Forwarded-For`-Header bestimmte den Rate-Limit-Schlüssel. | Express `req.ip` wird verwendet; nur eine explizite Proxy-Konfiguration darf Forwarding vertrauen. |
| Android-Daten | Android-Backup war für die App und die native Sitzung aktiviert. | Android-Systembackup deaktiviert. |
| Cookie/CORS | Lokale HTTP-Cookies wurden als `SameSite=None` ohne Secure markiert; native Preflights zählten gegen das Auth-Limit. | Lokales HTTP nutzt Lax; Produktion Secure/None; CORS läuft vor dem Auth-Limiter. |
| Konfiguration | Das Render-Blueprint enthielt keinen GitHub-Token für Elite-Missionen; Deployment-Doku nannte MySQL. | Secret-Einträge und Doku ergänzt. |

## Verbleibende Freigabekriterien

1. Den aktualisierten Android-Smoke-Job in PR #17 ausführen und Screenshot,
   UI-Text und Jobstatus prüfen. Der alte rote Lauf ist kein grüner Test.
2. `pnpm check`, `pnpm test`, `pnpm build` unter Node 22 und pnpm 10 ausführen.
3. Datenbankmigration `drizzle/0001_aspiring_sunfire.sql` gegen die Ziel-DB
   anwenden und anschließend mit einem berechtigten Konto Villa erstellen,
   umbenennen, Nachricht speichern und Villa löschen.
4. Native Google-Anmeldung und Dateiaktionen mit einem eigenen Testordner auf
   einem Android-Gerät/Emulator prüfen. Der CI-Smoke-Test prüft nur den Start,
   nicht die angemeldete Interaktion oder echte Dateiveränderungen.
5. Die für Elite-Missionen nötigen Server-Secrets `GITHUB_TOKEN`,
   `OPENROUTER_API_KEY`, `DATABASE_URL`, Google OAuth und `JWT_SECRET` setzen;
   den Draft-PR bis zu diesen Prüfungen nicht als produktionsfertig markieren.

## Architektur- und Funktionsgrenzen

- Agentenstatus und Systemprompt liegen nur im Prozessspeicher. Ein Neustart
  setzt sie zurück; es gibt weder dauerhafte Mission-Queue noch Wiederaufnahme
  eines unterbrochenen Laufs. Lange Missionen hängen an einer HTTP-Anfrage.
- Lokale Turn-Limits und Antwort-Cache sind pro Prozess; mit mehreren
  Instanzen fehlt eine gemeinsame Koordination.
- Der Dateimanager scannt nur die direkt ausgewählte Ordnerebene, maximal
  3.000 Einträge. Löschungen sind endgültig; Vorschau und Bestätigung bleiben
  Pflicht. Speicherstatistiken betreffen diesen Ordner, nicht das gesamte Gerät.
- Die frei verfügbaren Modellrouten sind extern begrenzt. „Unlimited“ meint
  nur das lokale Gesamtkontingent des Admin-Kontos.
- Vorlagenmodule wie `server/_core/map.ts`, `imageGeneration.ts` und
  `voiceTranscription.ts` sind nicht an die aktiven Router angebunden. Sie
  sollten erst nach einer gezielten Abhängigkeitsprüfung entfernt oder
  aktiviert werden; ihre Existenz bedeutet keine nutzbare Funktion.

Ein erfolgreicher Web-Build oder ein Android-Prozessstart allein erfüllt diese
Freigabekriterien nicht.
