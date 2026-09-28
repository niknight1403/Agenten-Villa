# Elite-Missionen: Persistenz und Wiederanlauf

Migration `drizzle/0003_workable_doorman.sql` legt `elite_mission_runs` an. Vor
einem Deployment anwenden. Jede gestartete Elite-Mission speichert Besitzer,
Idempotenzschlüssel, Eingabe-Hash, aufgelösten Auftrag, Status, Versuch,
Lease und Ergebnis in PostgreSQL. Die vorhandene `agent.eliteMission`-Mutation
bleibt synchron und liefert bei Erfolg ihre bisherige Antwort plus `missionId`.

Der Client sendet pro Klick einen UUID-Schlüssel und behält ihn bei einem
Netzwerkfehler für den erneuten Versuch mit unveränderter Eingabe. Wiederholt
der Admin den Schlüssel, wird ein gespeichertes Ergebnis zurückgegeben, ohne
das Modell erneut aufzurufen. Ein anderer Auftrag mit demselben Schlüssel
wird abgelehnt. Alt-Clients ohne Schlüssel funktionieren weiter, können einen
verlorenen HTTP-Response aber nicht idempotent wiederholen.
Mission Control zeigt die letzten Missions-IDs, Statuswerte und Versuche. Bei
`interrupted` bietet es einen ausdrücklich bestätigten Neustart mit Warnung
vor möglichen früheren GitHub-Änderungen an. Nach `failed` oder `interrupted`
kann der Admin nach Prüfung bewusst einen neuen Auftragsschlüssel erzeugen.

Laufende Missionen erneuern ihre Lease alle 20 Sekunden (90 Sekunden
Gültigkeit). Nach einem Prozessneustart wird ein abgelaufener Lauf bei der
nächsten Statusabfrage als `interrupted` markiert. Es startet dabei **kein**
Modellaufruf. `agent.eliteMissionRuns` und `agent.eliteMissionRun` zeigen dem
Administrator den gespeicherten Stand. Ein neuer Versuch erfordert
`agent.restartInterruptedMission({ id, acknowledgeExternalChanges: true })`.
Die Mutation führt den gespeicherten Auftrag dann ausdrücklich **von vorn**
aus; sie setzt keine Modell- oder GitHub-Werkzeugrunde an ihrem letzten
Einzelschritt fort. Vor dem Neustart sind vorhandene `agent/*`-Branches und
Draft-PRs zu prüfen: Ein vorheriger Versuch kann bereits externe Änderungen
geschrieben haben. Eine neue Versuchsgeneration und Owner-Fencing verhindern,
dass ein überholter Versuch den neuen DB-Status überschreibt; vor jeder
GitHub-Aktion wird die Lease geprüft.

## Grenzen und Freigabe

- Keine persistierten GitHub-Werkzeug-Checkpoints und keine garantierte
  genau-einmal-Ausführung externer Aktionen. Bei DB-Ausfall während einer
  externen Aktion ist eine manuelle Prüfung vor dem expliziten Neustart nötig.
- Die Lease schützt vor abgestürzten Prozessen; bei mehreren parallel
  betriebenen Web-Instanzen ist ein zentraler Worker mit harter Abbruch- und
  Tool-Fencing-Grenze für streng garantiertes Nichtüberlappen erforderlich.
- Gespeicherter Auftrag und Ergebnis können Projekttexte/Chatverlauf enthalten.
  Zugang ist Admin und Besitzer vorbehalten. Vor Produktion brauchen diese
  Daten eine festgelegte Aufbewahrungsfrist und Löschstrategie.
- Migration und Statuswechsel gegen die Ziel-Datenbank prüfen; Tests und Build
  allein belegen keine tatsächliche Wiederaufnahme im Produktionsbetrieb.
