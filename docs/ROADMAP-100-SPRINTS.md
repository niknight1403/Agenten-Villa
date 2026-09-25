# Agenten-Villa: 100-Sprint-Roadmap

**Stand:** 25. September 2026  
**Ausgangspunkt:** Repository `niknight1403/Agenten-Villa`, Branch `main`, Commit `69df273`  
**Roadmap-Ziel:** Eine sichere, mobile-optimierte Agenten-Plattform mit nachvollziehbarer Villa-Orchestrierung, begrenzten Testläufen, Provider-Fallbacks, Administratorsteuerung und reproduzierbarer Qualität.

## Planungsgrundsätze

Die Roadmap verwendet „Sprint“ als eine klar abgegrenzte, überprüfbare Umsetzungseinheit. Jeder Sprint erhält vor Abschluss mindestens einen automatisierten Test oder eine reproduzierbare technische Prüfung. Externe Provider, Kontingente und Berechtigungen werden nicht umgangen. Kostenlose Anbieter werden nur innerhalb ihrer dokumentierten Limits verwendet. Autonome Abläufe bleiben stoppbar, zeitlich begrenzt und sichtbar.

Die zehn Bereiche sind sequenziell priorisiert. Innerhalb eines Bereichs können einzelne Sprints parallel vorbereitet werden, abgeschlossen werden sie jedoch erst nach erfolgreicher Qualitätsprüfung.

## Sprint-Definition of Done

Ein Sprint ist grün, wenn seine Akzeptanzkriterien erfüllt sind, `pnpm check`, `pnpm test` und `pnpm build` erfolgreich laufen, sicherheitsrelevante Änderungen einen Regressionstest besitzen und der Arbeitsbaum keine unbeabsichtigten Änderungen enthält. Bei UI-Sprints kommt eine mobile und Desktop-Visualprüfung hinzu.

## 1. Fundament und Entwicklungsqualität

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 001 | Roadmap und Sprintstatus versionieren | Roadmap, Statusdatei und Startkriterien liegen im Repository. |
| 002 | Einheitliches Validierungsskript | Ein Befehl führt Typecheck, Tests und Build reproduzierbar aus. |
| 003 | Format- und Diff-Prüfung standardisieren | Formatprüfung ist lokal und in CI aufrufbar. |
| 004 | Testartefakte dokumentieren | Jede Validierung benennt Ergebnisse und bekannte Einschränkungen. |
| 005 | Node- und pnpm-Version festschreiben | CI und lokale Hinweise verwenden dieselben Versionen. |
| 006 | Branch-Schutz dokumentieren | Merge-Anforderungen und Pflichtprüfungen sind beschrieben. |
| 007 | Testdaten von Geheimnissen trennen | Keine Tests benötigen echte Provider-Schlüssel. |
| 008 | Fehlerklassifikation vereinheitlichen | Infrastruktur-, Eingabe- und Providerfehler besitzen stabile Klassen. |
| 009 | Reproduzierbare lokale Seed-Daten | Testdaten können deterministisch erzeugt und gelöscht werden. |
| 010 | Fundament-Review | Alle Fundament-Akzeptanzkriterien sind in CI grün. |

## 2. Villa- und Projektverwaltung

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 011 | Villa-Liste mit Ownership | Nutzer sehen nur berechtigte Villen. |
| 012 | Villa-Erstellung erweitern | Name, Projekt, Kapazität und Beschreibung werden validiert. |
| 013 | Villa-Bearbeitung | Änderungen sind persistiert und auditierbar. |
| 014 | Villa-Archivierung | Archivierte Villen starten keine neuen Läufe. |
| 015 | Projektzuordnung | Ein Projekt kann genau einer oder mehreren erlaubten Villen zugeordnet werden. |
| 016 | Superagenten-Profile | Rollen und Aufgabenprofile sind konfigurierbar. |
| 017 | Kapazitätsgrenzen | Eingaben über der konfigurierten Grenze werden abgewiesen. |
| 018 | Villa-Import und Export | Eine Villa kann als validiertes JSON exportiert und importiert werden. |
| 019 | Villa-Aktivitätsübersicht | Letzte Läufe, Fehler und Status sind pro Villa sichtbar. |
| 020 | Verwaltungs-Review | CRUD, Ownership und Persistenzfehler sind getestet. |

## 3. Autonome Testläufe und Controller

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 021 | Begrenzten Testlauf modellieren | Laufstatus, Startzeit, Endzeit und Ergebnis sind persistiert. |
| 022 | Start/Stop idempotent machen | Wiederholte Start- und Stop-Aktionen erzeugen keinen inkonsistenten Zustand. |
| 023 | Phasenmodell | Vorbereitung, Planung, Ausführung, Prüfung und Ergebnis sind sichtbar. |
| 024 | Countdown und Fortschritt | Fortschritt wird deterministisch aus Zeitgrenzen berechnet. |
| 025 | Live-Aktivitätsprotokoll | Jeder Lauf zeigt die letzten lokalen Ereignisse. |
| 026 | Abbruchgrund erfassen | Manuelle und technische Abbrüche werden unterschieden. |
| 027 | Wiederaufnahme-Regeln | Nur sichere, explizit freigegebene Läufe können fortgesetzt werden. |
| 028 | Laufbericht | Abschlussbericht enthält Status, Dauer, Phasen und Fehler. |
| 029 | Controller-Berechtigungen | Nur Administratoren dürfen globale Steuerungen verwenden. |
| 030 | Controller-Review | Laufzustände, Rechte und Regressionstests sind grün. |

## 4. Provider-Routing und Kontingente

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 031 | Providerregister | Provider besitzen dokumentierte Fähigkeiten und Statusfelder. |
| 032 | Fallback-Reihenfolge | Fallbacks sind deterministisch und konfigurierbar. |
| 033 | Rate-Limit-Erkennung | 429, 402 und Timeout werden korrekt klassifiziert. |
| 034 | Cooldown-Mechanismus | Fehlerhafte Provider werden zeitlich begrenzt übersprungen. |
| 035 | Kontingentanzeige | Genutzte und verbleibende lokale Fenster werden angezeigt. |
| 036 | Provider-Gesundheitscheck | Checks verwenden ungefährliche, begrenzte Anfragen. |
| 037 | Fail-closed bei fehlender Berechtigung | Fehlende Schlüssel führen nicht zu stillen Umgehungsversuchen. |
| 038 | Router-Telemetrie | Latenz, Erfolg und Fallback-Grund werden aggregiert. |
| 039 | Router-Stresstest | Hohe lokale Mock-Last bleibt stabil und sicher. |
| 040 | Routing-Review | Provider- und Sicherheitsregressionen sind grün. |

## 5. Agenten-Engine und Capability-Packs

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 041 | Agentenauftragsschema | Eingaben, Kontext und Ergebnis besitzen validierte Schemas. |
| 042 | Capability-Packs katalogisieren | Jedes Pack beschreibt Zweck, Berechtigungen und Grenzen. |
| 043 | Werkzeug-Permissions | Tools werden vor der Ausführung autorisiert. |
| 044 | Aufgabenkontext isolieren | Ein Agent erhält nur den Projekt- und Villa-Kontext seines Auftrags. |
| 045 | Retry-Regeln | Wiederholungen besitzen Backoff und ein festes Maximum. |
| 046 | Ergebnisvalidierung | Ungültige Agentenergebnisse werden sicher abgewiesen. |
| 047 | Human-in-the-loop-Punkte | Riskante Aktionen werden als Freigabepunkte markiert. |
| 048 | Agentenmetriken | Laufzeit, Fehler und Ergebnisstatus werden erfasst. |
| 049 | Prompt- und Kontextversionierung | Änderungen sind nachvollziehbar und rücksetzbar. |
| 050 | Engine-Review | Engine, Packs und Tool-Sicherheitsgrenzen sind getestet. |

## 6. Sicherheit und Administratorzugriff

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 051 | Rollenmodell prüfen | Administrator, Operator und Viewer sind getrennt. |
| 052 | Audit-Log | Kritische Änderungen besitzen Zeit, Nutzer und Aktion. |
| 053 | Eingabegrenzen | Länge, Zeichen und numerische Grenzen sind zentral definiert. |
| 054 | Secret-Redaction | Providerfehler und Logs enthalten keine Schlüssel. |
| 055 | CSRF- und Session-Review | Geschützte Mutationen werden geprüft. |
| 056 | Rate-Limit für Adminaktionen | Wiederholte Mutationen werden begrenzt. |
| 057 | Export-Schutz | Exporte enthalten keine unberechtigten Daten. |
| 058 | Sicherheitsheader | Browser-Sicherheitsheader sind in Produktion gesetzt. |
| 059 | Dependency-Review | Dependabot- und Audit-Ergebnisse sind dokumentiert. |
| 060 | Security-Review | Kritische Schutzpfade besitzen Regressionstests. |

## 7. Mobile UX und Offline-Fähigkeit

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 061 | Mobile Navigation | Kernbereiche sind mit einer Hand erreichbar. |
| 062 | Villa Factory mobil | Erstellung und Start/Stop funktionieren auf kleinen Displays. |
| 063 | Animierte Fortschrittsanzeige | Animationen berücksichtigen Reduced Motion. |
| 064 | Offline-Chatcache | Cache ist versioniert, begrenzt und validiert. |
| 065 | Offline-Villaansicht | Letzter sicherer Status bleibt lesbar. |
| 066 | Synchronisationskonflikte | Lokale und Serveränderungen werden nachvollziehbar aufgelöst. |
| 067 | Touch-Zielgrößen | Interaktive Ziele erfüllen mobile Mindestgrößen. |
| 068 | Fehler- und Ladezustände | Kein Flow endet in einer leeren oder blockierten Ansicht. |
| 069 | Mobile Accessibility | Kontrast, Labels und Fokus werden geprüft. |
| 070 | Mobile-Review | iOS-, Android- und Web-relevante Pfade sind geprüft. |

## 8. Daten, Persistenz und Beobachtbarkeit

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 071 | Persistenzschema dokumentieren | Tabellen, Relationen und Migrationen sind beschrieben. |
| 072 | Migrationsprüfung | Migrationen sind reproduzierbar und rückwärtskompatibel geplant. |
| 073 | Fehler-Mapping | Datenbankfehler werden in sichere API-Fehler übersetzt. |
| 074 | Idempotente Mutationen | Wiederholte Requests erzeugen keine Duplikate. |
| 075 | Datenaufbewahrung | Lauf- und Auditdaten besitzen klare Aufbewahrungsregeln. |
| 076 | Backup-Export | Administrativer Export ist validiert und geschützt. |
| 077 | Health-Endpunkte | App, Datenbank und Providerstatus sind getrennt prüfbar. |
| 078 | Strukturierte Logs | Logs enthalten Korrelation, Status und Dauer. |
| 079 | Metrik-Dashboard | Kernmetriken sind pro Villa und Projekt filterbar. |
| 080 | Daten-Review | Persistenz-, Health- und Logpfade sind grün. |

## 9. Qualität, Last und Release

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 081 | Unit-Test-Abdeckung erhöhen | Kritische Routing- und Controllerpfade sind abgedeckt. |
| 082 | API-Integrationstests | Authentifizierte und fehlerhafte Requests sind getestet. |
| 083 | UI-Komponententests | Kernaktionen besitzen stabile Interaktionstests. |
| 084 | End-to-End-Smoke-Test | Login, Villa, Lauf und Bericht werden durchlaufen. |
| 085 | Lasttest mit Mock-Providern | Router bleibt innerhalb definierter Latenzgrenzen. |
| 086 | Fehler-Injection | Timeout, Rate-Limit und Persistenzfehler werden simuliert. |
| 087 | Build-Reproduzierbarkeit | CI erzeugt wiederholbar dasselbe Artefaktformat. |
| 088 | Release-Checkliste | Version, Migration, Rollback und Monitoring sind enthalten. |
| 089 | Rollback-Test | Ein vorheriger Checkpoint kann sicher wiederhergestellt werden. |
| 090 | Release-Review | Qualitäts- und Releasekriterien sind grün. |

## 10. Produktreife und Erweiterbarkeit

| Sprint | Ziel | Akzeptanzkriterium |
|---|---|---|
| 091 | Projektvorlagen | Häufige Agentenprojekte können als sichere Vorlage angelegt werden. |
| 092 | Rollenbasierte Dashboards | Dashboard-Inhalte passen sich der Rolle an. |
| 093 | Mehrsprachigkeit vorbereiten | UI-Texte sind zentral und übersetzbar organisiert. |
| 094 | Theme-System stabilisieren | Aurora, Command Deck und helle Variante teilen Tokens. |
| 095 | Erweiterungspunkte | Neue Provider, Packs und Phasen können ohne Kernumbau ergänzt werden. |
| 096 | Administrator-Handbuch | Betrieb, Grenzen und Notfallstop sind dokumentiert. |
| 097 | Nutzer-Onboarding | Neue Nutzer können eine Villa ohne Sackgasse erstellen. |
| 098 | Produkt-Telemetrie | Nur datenschutzkonforme, optionale Metriken werden erhoben. |
| 099 | Gesamt- und Sicherheitsreview | Alle Bereiche besitzen einen dokumentierten grünen Status. |
| 100 | Release 1.0 | Roadmap, Tests, Dokumentation und Produktionsbuild sind vollständig grün. |

## Startstatus

Die ersten drei Sprints werden direkt mit diesem Roadmap-Commit umgesetzt. Der Repository-Zustand enthält derzeit keine offenen GitHub-Issues. Das untracked Verzeichnis `designs/` bleibt außerhalb dieser Roadmap unangetastet, bis eine eigene Entscheidung zur Versionierung getroffen wurde.

## References

[1]: https://github.com/niknight1403/Agenten-Villa "Agenten-Villa Repository"
