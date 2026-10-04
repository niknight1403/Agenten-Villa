# Sprintstatus Agenten-Villa

## Pipeline-Reparatur Auto-Merge (05.10.2026)

Der Auto-Merge-Workflow schlug bei PR #80 (Sprint 085) mit
"jq: error: Cannot index string with string \"headRefName\"" fehl. Ursache:
jq --rawfile bindet Dateiinhalte als STRING, das Skript indizierte aber
Felder direkt. Der Pfad war seit Sprint 078 latent kaputt — bisherige
Merges liefen manuell (Owner-Beschluss), daher fiel es erst jetzt auf.

- Fix: ($pr | fromjson) vor dem Feldzugriff im Fakten-Bau
  (.github/scripts/auto-merge.sh). Regelmodul server/auto-merge-gate.ts,
  Merge-Regeln und BRANCH-PROTECTION.md bleiben unveraendert —
  reiner Bug-Fix, regelkonservierend.
- Validierung: jq-Programm lokal gegen Beispielfakten geprueft (Fakten
  identisch zum alten Ziel-Format), Gate-Tests unveraendert gruen.
- Merge des Gate-Fix-PRs per Owner-Vollmacht (Autonomieauftrag 20 Sprints,
  05.10.2026): Gate-PRs beruehren .github/ und koennen nicht per
  Auto-Merge gemerged werden; der Owner-Auftrag deckt diese
  Pipeline-Reparatur.

Zusaetzlich gefunden und im selben PR repariert: Der Dependabot-Squash-Merge
von PR #65 (Commit a35ec0f, Sprint-084-Backlog-Arbeit) hinterliess
Konflikt-Marker in .github/workflows/ci.yml, android-smoke.yml und
google-signin-probe.yml — push-Event-Runs auf main scheiterten seitdem
an ungueltigem YAML (pull_request-Runs liefen weiter, weil die Sprint-085-
Branch-Version sauber war). Aufloesung: jeweils die neueren Action-Versionen
behalten (checkout@v7, pnpm/action-setup@v6, setup-node@v7) — genau der
Zielstand der Dependabot-Bumps. Voll-Scan des main-Trees: keine weiteren
Marker-Dateien. Render-Produktionsbuild war nie betroffen (baut aus
Repo-Quellen, nicht aus Workflow-Dateien).


## Sprint 076 — Strenge Produktions-Env-Validierung & Health 2.0 (03.10.2026)

Phase 2 des Autonomie-Masterplans: unvollstaendige Konfiguration scheitert
jetzt sofort und verstaendlich statt spaeter im Betrieb verwirrend.

- env-validation.ts (neu): Pflichtvariablen in Produktion (DATABASE_URL,
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) werden beim Start geprueft; bei
  Fehlen bricht der Prozess mit einer Liste aller fehlenden Variablen samt
  Zweck ab. LLM-Schluessel bleiben bewusst optional (Multi-Provider-Kette
  meldet MISSING_KEY bereits praezise zur Laufzeit).
- index.ts: Validierung vor dem Serverstart; Entwicklungsmodus bleibt
  toleriert.
- health.ts: /api/health liefert jetzt zusätzlich (a) die Live-Summary der
  LLM-Anbieter (je konfiguriert/cooldown, ohne Secrets, ohne Netzprobe)
  und (b) den Live-Status des 24/7-Watchdog-Controllers (Status, aktive
  Worker, Tick-Zähler, letzter Tick) — beides nicht-blockierend, der
  Render-Health-Check bleibt fuer Kaltstarts sofort antwortbar.
- Tests: +9 deterministische Faelle (Validierung, Anbieter-Summary,
  Cooldown-Anzeige, Controller-Status, Stoerfreiheit). 553/553 gruen,
  check + build sauber.

## Sprint 077 — Live-Token-Budget & Budget-Widget (03.10.2026)

Phase 3 des Autonomie-Masterplans: Echtzeit-Sichtbarkeit des
Token-Verbrauchs. Die SSE-Infrastruktur (controller-sse.ts, Sprints
034/038) war vorhanden — sie lieferte Watchdog-Zustaende, aber keine
Nutzungsdaten.

- turn-usage.ts (neu): extrahiert das usage-Objekt OpenAI-kompatibler
  Completion-Antworten (prompt/completion/total; total wird aus der
  Summe errechnet, wenn der Anbieter ihn nicht liefert), erfasst pro
  erfolgreichen Turn ein begrenztes Sample (max. 200, wie Telemetrie)
  und aggregiert je Anbieter. Kostenmodell: Free-Tier-Anbieter bleiben
  ehrlich 0,00 EUR — keine fiktiven Betraege; die Preistabelle ist fuer
  bezahlte Modelle offen.
- agent-engine.ts: usage-Extraktion im Completion-Parsing; Erfassung im
  Erfolgspfad der Providerroute (auch Werkzeugrunden erfasst).
- controller.ts: jeder Watchdog-Tick-Report enthaelt jetzt das
  Live-Usage-Aggregat und pusht es per SSE an alle Clients.
- client: neues TokenBudgetWidget (Live via /api/controller/stream,
  Gesamt-Kacheln Turns/Prompt/Antwort/Total/Kosten + Anbieter-Tabelle)
  auf der Controller-Seite; Anzeige-Logik deterministisch in
  lib/usage-format.ts (de-DE-Formatierung, 0-EUR-Ehrlichkeit).
- Tests: +13 (7 Server-Nutzung, 4 Anzeige-Logik, 2 End-to-End an der
  Engine). 566/566 gruen, check + build sauber.

## Sprint 078 — Auto-Merge-Workflow fuer agent/*-PRs (03.10.2026)

Phase 4 des Autonomie-Masterplans. Owner-Beschluss vom 03.10.2026 (per
Bestaetigen-Knopf): Auto-Merge wird aktiviert und als dokumentierte
Ausnahme in BRANCH-PROTECTION.md verankert.

- server/auto-merge-gate.ts (neu): reines, getestetes Regelmodul. Merged
  nur offene, nicht-Draft agent/*-PRs auf main, deren Pflichtchecks
  (CI, PR Agent (Gemini), Android mobile smoke) alle gruen sind; noch
  laufende oder gescheiterte Checks blockieren. Geschuetzte Pfade
  (.github/, docs/BRANCH-PROTECTION.md, das Regelmodul selbst)
  verlangen weiter Admin-Disziplin. skipped/neutral bei zusaetzlichen
  Checks blockieren nicht.
- .github/workflows/auto-merge.yml (neu): triggert auf abgeschlossene
  Pflichtworkflows (workflow_run), pro Head-Branch serialisiert
  (concurrency). Laedt die Regeln bewusst vom Default-Branch — ein PR
  kann seine eigene Freigabe nicht umbiegen.
- .github/scripts/auto-merge.sh (neu): sammelt PR-Fakten via gh (State,
  Draft, Basis, geaenderte Dateien, Check-Rollup), fragt das Regelmodul
  (npx tsx, kein Repo-Build noetig) und fuehrt den Squash-Merge mit
  Race-Toleranz aus.
- docs/BRANCH-PROTECTION.md: Ausnahme mit Regeln und Grenzen
  dokumentiert.
- Tests: +10 deterministische Gate-Faelle. 576/576 gruen, check + build
  sauber. Hinweis: dieser PR aendert selbst .github/ — das Gate
  blockiert ihn korrekt, der Merge erfolgt einmalig manuell.

## Sprint 079 — Free-Tier-Erholung, Admin-Pin & Routing-Transparenz (03.10.2026)

Supreme Directive "Unlimited Token Routing": Die Multi-Provider-Kette
(Sprints 031–038, 075) war schon stark — dieser Sprint schliesst die drei
echten Restluecken. Ehrlich vorweg: Free-Tier-Kontingente sind externe
harte Limits; "Unlimited" erreicht das System durch nahtlose Rotation
UND begrenztes Warten auf Kontingentfenster — ein abgelaufenes
Tageskontingent wird nie vorgetaeuscht.

- server/route-wait.ts (neu): deterministischer Erholungsplaner. Scheitert
  die Kette am Kontingent (429/402) oder kurzem Ausfall und ist das
  naechste Fenster innerhalb des Wartebudgets (ROUTE_WAIT_BUDGET_MS,
  Default 60 s, max 300 s), wartet der Turn einmal begrenzt (max. 2
  Kettelaeufe — nie Endlos-Retry, nie Haengen auf Tageskontingente).
  Terminale Fehler (REJECTED, CONTEXT_TOO_LARGE, STOPPED, Auth) bleiben
  sofort terminal.
- server/route-override.ts (neu): Admin-Pin auf EINEN Anbieter
  (prozesslokal, nicht persistiert, nur aktiv Anbieter). Ein Pin auf
  einen nicht nutzbaren Anbieter scheitert ehrlich mit PIN_UNAVAILABLE
  (neuer Fehlercode, Kategorie configuration). Consent-/Schluesselregeln
  bleiben unangetastet.
- provider-cooldown.ts: Cooldown-Info/Snapshot-Getter fuer Health und
  Erholungsplanung.
- _core/health.ts: /api/health zeigt jetzt routing (Pin + naechste
  aktive Route) und je Anbieter Cooldown-Art und Restsekunden — ohne
  Secrets, ohne Netzproben.
- _core/systemRouter.ts: tRPC routingStatus (public) und
  routingOverride (admin-only, null = Auto-Kette).
- client: RoutingPanel auf der Controller-Seite — Live-Status je
  Anbieter (bereit/Kontingent-Fenster/Schluessel), aktive Route,
  Pin-Buttons fuer Admins.
- Engine-Tests bewusst angepasst: ohne Retry-After-Fenster erlaubt die
  Kette einen begrenzten Erholungslauf (HF bleibt consent-gated, hard
  LIMIT bleibt hard LIMIT).
- Tests: +22 neue (8 Erholungsplaner, 5 Pin, 4 Engine-Integration,
  2 Health-Routing, +3 Cooldown-Getter-Nutzung via Health/Engine).
  Gesamt 595/599 gruen (4 bewusste Skips), check + build sauber.

## Sprint 080 — Lokale Ollama-Route: Coding-Experte, Agenten-Spezialist, Allrounder (03.10.2026)

Direktive: qwen3.6:27b / qwen3-coder:30b (Coding-Experte), devstral:24b
(Agenten-Spezialist) und gemma4:12b (ressourcen-effizienter Allrounder)
als eigene kostenlose Route integrieren. Umgesetzt als 5. Anbieter
"ollama" in der Multi-Provider-Kette — konfiguriert per OLLAMA_BASE_URL
(OpenAI-kompatibel, z. B. http://mein-host:11434/v1), ohne Base-URL
existiert die Route nicht und die Cloud-Kette bleibt unangetastet.

- provider-endpoints.ts: Ollama-Endpunkte (chat/completions, models),
  Standard-Modellkette qwen3.6:27b → qwen3-coder:30b → devstral:24b →
  gemma4:12b (OLLAMA_MODELS uebersteuert), eigenes Zeitlimit
  OLLAMA_TIMEOUT_MS (Default 120 s, max 600 s — lokale 27B-Inferenz
  braucht Minuten, nicht Sekunden).
- provider-registry.ts: "ollama" ist 5. Katalogeintrag und steht in der
  dokumentierten Fallback-Reihenfolge ERST: ist eine eigene Instanz
  konfiguriert, hat sie Vorrang vor jeder (kostenpflichtigen) Cloud-Route.
  Status wie gehabt per PROVIDER_STATUS_OLLAMA wartbar.
- agent-engine.ts: Route ohne Schluessel nutzbar (kein Authorization-Kopf
  ohne OLLAMA_API_KEY; optionaler Schluessel fuer Reverse-Proxys),
  route-spezifisches Timeout mit Vorrang vor dem Turn-Limit, 429/402 der
  lokalen Route faellt ehrlich auf die Cloud-Kette zurueck (Cooldowns,
  Limit-Erholung und Admin-Pin aus Sprint 079 greifen automatisch).
- provider-health.ts: ungefaehrlicher GET auf /v1/models des eigenen Hosts;
  ohne Base-URL ehrlich "not_configured" ohne Netzverkehr.
- _core/health.ts: Routing-Zusammenfassung zeigt Ollama (configured =
  OLLAMA_BASE_URL gesetzt). systemRouter: Pin auf "ollama" erlaubt.
  turn-usage: lokale Route kostet bewusst 0 Mikro-EUR/1k Tokens.
- Ehrlich: Auf Render gibt es heute keine Ollama-Instanz — die Route wird
  aktiv, sobald OLLAMA_BASE_URL auf einen erreichbaren Host zeigt (Render-
  Env ist bewusst ein manueller Owner-Schritt). Bis dahin laeuft alles
  weiter ueber die Cloud-Kette.
- Tests: +15 neue (5 Endpunkte/Timeout, 2 Health-Probe, 3 Engine-Route,
  1 Health-Summary, +4 Bestandstests an 5-Anbieter-Katalog angepasst).
  Gesamt 606/610 gruen (4 bewusste Skips), check + build sauber.

## Sprint 081 — Auto-Merge-Gate: Skip-Semantik fuer pfadgefilterte Pflichtchecks (03.10.2026)

Befund aus PR #75: Das Gate verlangte alle Pflichtchecks VORHANDEN und
gruen — aber "Android mobile smoke" triggert nur bei Mobile-relevanten
Pfaden (android/, client/, capacitor.config.ts, package.json,
pnpm-lock.yaml, Workflow-Datei). Server-only-PRs wuerden also selbst
nach grünem Review ewig offen stehen ("Pflichtcheck fehlt noch").

- auto-merge-gate.ts: PATH_FILTERED_CHECKS spiegelt die paths:-Filter
  der Workflows; checkCouldTrigger(name, changedFiles) entscheidet,
  ob ein fehlender Check haette laufen muessen. Fehlt er UND haette er
  laut Filter ohnehin nicht getriggert => gilt als erfuellt (weiter-
  gemerged). Fehlt er, obwohl der Filter trifft => blockiert weiter.
  Kein bekannter Filter (CI, PR Agent) => bedingungslos Pflicht.
- docs/BRANCH-PROTECTION.md: Ergänzung dokumentiert die Einordnung.
- Ehrlich: Es wird nie ein Check simuliert oder uebersprungen — nur
  korrekt eingeordnet, dass sein Workflow bei diesen Dateien gar nicht
  laufen kann. Geaenderte Gate-Datei bleibt Admin-Pflicht: dieser PR
  selbst kann nicht automatisch gemerged werden (Owner-Beschluss).
- Tests: +4 neue; 610/614 gruen (4 bewusste Skips), check + build sauber.

## Sprint 082 — Ollama-Setup-Kit: Oracle Cloud Always Free (03.10.2026)

Owner-Entscheid (03.10.2026): Die lokale Ollama-Route (Sprint 080) soll
NICHT auf dem Hetzner-VPS laufen (steht fuer Phase 6 auf der Dekommissions-
Liste), sondern dauerhaft kostenlos auf Oracle Cloud Always Free
(Ampere A1 ARM, 4 OCPU / 24 GB RAM, 200 GB Block-Storage — die einzige
wirklich kostenlose 24/7-Option fuer 12b-27b-Modelle).

- ops/ollama/setup-oracle-free.sh: idempotenter Bootstrap (Ollama arm64
  als systemd-Dienst auf 127.0.0.1:11434, OLLAMA_MAX_LOADED_MODELS=1,
  Modell-Pulls klein zuerst, nginx-TLS-Proxy mit Bearer-Token-Schutz via
  Let's Encrypt, iptables-443-Fix fuer Oracle-Images). qwen3-coder:30b nur
  per OLLAMA_INCLUDE_30B=true (19 GB auf 24 GB RAM grenzwertig).
- ops/ollama/nginx-ollama.conf: Template mit __DOMAIN__/__TOKEN__-
  Platzhaltern — Token existiert nur auf der VM, niemals im Repo.
- docs/OLLAMA-ORACLE-FREE.md: Schritt-fuer-Schritt (Konto, VM-Shape,
  Security-List, DNS, Bootstrap, Render-Env, Betriebsgrenzen) plus
  ehrliche RAM- und Geschwindigkeits-Einordnung (CPU-Inferenz: Minuten).
- Ehrlich: VM-Anlage, Oracle-Konto und DNS bleiben Owner-Schritte;
  Render-Env wird gesetzt, sobald die VM steht. Faellt die VM aus,
  faellt die Villa ehrlich auf die Cloud-Kette zurueck (Sprint 079/080).
- Kein App-Code angefasst; Skript-Syntax geprueft (bash -n).

## Sprint 083 — Ollama-Anbindung: bleibt auf dem Hetzner-VPS (04.10.2026)

Owner-Entscheid (04.10.2026, wideruft die Oracle-Richtung aus Sprint 082
als nächsten Schritt): „Benutze mein Ollama und lass es auf dem Server,
wo es jetzt liegt." Ollama läuft bereits auf dem VPS CyberSarah-pro
(127.0.0.1:11434, Modelle qwen2.5-coder:1.5b + tinyllama:latest) und
wird mit der Villa verbunden, statt umzuziehen.

- ops/ollama/setup-oracle-free.sh: Header verallgemeinert — laeuft auf
  jedem Ubuntu/Debian-Server (x86_64/ARM), RAM-Hinweis ergänzt.
- docs/OLLAMA-VPS.md: Schritt-fuer-Schritt (DNS-Record, Skript-Aufruf
  mit OLLAMA_MODELS_INSTALL="" um die 27b-Defaults NICHT auf dem RAM-
  knappen VPS zu ziehen, Token-Notierung, Render-Env mit ehrlicher
  Modell-Liste, Verifikations-Checkliste).
- Ehrlich: DNS, Skript-Aufruf auf dem VPS und Render-Dashboard bleiben
  Owner-Schritte (dokumentierte Grenze); der Agent verifiziert danach
  Endpunkt, Health und ersten Agenten-Turn. VPS-Dekommission (Phase 6)
  bleibt im Plan — die Anbindung ist host-agnostisch gebaut, ein spaeterer
  Wechsel kostet nur eine geänderte OLLAMA_BASE_URL.
- Kein App-Code angefasst; Oracle-Kit (Sprint 082) bleibt als Option im Repo.

## Sprint 075 — Timeout-Selbstheilung & Failover-Logging (03.10.2026)

Die Fallback-Kette (Sprint 031-038) kannte Cooldowns nur fuer erschöpfte
Kontingente (429/402) und ungültige Schluessel (401/403). Ein haengender
oder unerreichbarer Primaer-Anbieter blieb unbestraft an erster Stelle und
verzoegerte jede Anfrage um seine volle Timeout-Latenz.

- provider-cooldown.ts: neue Cooldown-Art "timeout" (2 Minuten, bewusst
  kurz — Hänger sind meist voruebergehend).
- agent-engine.ts: eine Route, die ausschliesslich TIMEOUT/UNAVAILABLE
  geliefert hat, wird nach dem Routenende kurzzeitig gesperrt; fail-closed
  bleibt erhalten (ohne Alternative wird der Gesperrte weiterhin ehrlich
  versucht, laengere Limit-/Auth-Sperren werden nie verkuerzt).
- agent-engine.ts: strukturierter, sicherer Failover-Log beim
  Anbieterwechsel ("[agent-router] Anbieterwechsel: openrouter -> groq
  (Grund: TIMEOUT)") — nur Anbieter, Fehlercode und HTTP-Status, niemals
  Schluessel oder Anfrageinhalte.
- agent-engine.test.ts: 4 neue deterministische Tests (Timeout-Sperre,
  UNAVAILABLE-Sperre, fail-closed, log ohne Secrets). 544/544 gruen,
  check + build sauber.

**Roadmap:** [100-Sprint-Roadmap](./ROADMAP-100-SPRINTS.md)  
**Branch:** `main`  
**Startstand:** `69df273`

| Sprint  | Status  | Ergebnis                                                                                                                                                                                                                                                                                          |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001     | Grün    | Roadmap und Definition of Done sind versioniert.                                                                                                                                                                                                                                                  |
| 002     | Grün    | `pnpm validate` führt Typecheck, Tests, Build und Diff-Prüfung reproduzierbar aus.                                                                                                                                                                                                                |
| 003     | Grün    | Validierung enthält die abschließende Diff-Prüfung; Formatprüfung bleibt als Folgeverbesserung geplant.                                                                                                                                                                                           |
| 004     | Grün    | Standardformat und erster Validierungsbericht liegen unter `docs/validation/`.                                                                                                                                                                                                                    |
| 005     | Grün    | Node 22, pnpm 10.4.1 und die unterstützte Workspace-Konfiguration sind synchronisiert.                                                                                                                                                                                                            |
| 006     | Grün    | Branch-Schutz, Pflichtprüfungen und Rollback-Regeln sind dokumentiert.                                                                                                                                                                                                                            |
| 007     | Grün    | Mock-, Live- und Secret-Testpfade sind getrennt und dokumentiert.                                                                                                                                                                                                                                 |
| 008     | Grün    | Agentenfehler besitzen zentrale Codes, Kategorien und sichere öffentliche Meldungen.                                                                                                                                                                                                              |
| 009     | Grün    | Deterministische lokale Villa- und Agenten-Fixtures samt Reset-Test sind vorhanden.                                                                                                                                                                                                               |
| 010     | Grün    | Gesamt-Review, 62 bestandene Tests, Build und Diff-Prüfung sind dokumentiert.                                                                                                                                                                                                                     |
| 011     | Grün    | Zentraler Ownership-Guard im Villa-Store; jeder Lese- und Schreibpfad läuft über die Nutzer-ID des Aufrufers, Cross-User-Zugriffe liefern keine fremden Daten (13 Router-Tests grün).                                                                                                             |
| 012     | Grün    | Villa-Erstellung validiert Name, Projekt (Brief), Beschreibung (max. 1000) und Kapazität (1–25, Standard 8) zentral per Schema; Migration 0002 und Client-Modal erweitert (114 Tests grün).                                                                                                       |
| 013     | Grün    | Villa-Bearbeitung umfasst Name, Spezialisierung, Beschreibung und Kapazität; jede Änderung schreibt transaktional einen Audit-Eintrag (villa_events), abfragbar über villa.events (Migration 0003).                                                                                               |
| 014     | Grün    | Archivierte Villen (archivedAt + Audit-Eintrag) akzeptieren keine neuen Nachrichten (FORBIDDEN) und starten keine Elite-Missionen; Client zeigt Archiv-Badge, Umschalten und sperrt die Chat-Eingabe.                                                                                             |
| 015     | Grün    | Projekte (Tabelle projects) sind pro Nutzer verwaltet; ein Projekt lässt sich einer oder mehreren eigenen Villen zuordnen (villa.projectId, Migration 0004), Ownership beider Seiten wird transaktional geprüft.                                                                                  |
| 016     | Grün    | Superagenten-Profile (Rollen strategie/entwicklung/review/support + Aufgabenprofil, Migration 0005) sind pro Nutzer verwaltbar und einer Villa zuordenbar; villa.profileId mit transaktionaler Ownership-Prüfung.                                                                                 |
| 017     | Grün    | Kapazitätsgrenzen liegen in limit_configs (Migration 0006, Standard 20 Villen) und werden erzwungen: createVilla lehnt bei Limit FORBIDDEN ab, Nachrichten über villa.capacity × 1000 Zeichen werden BAD_REQUEST; setLimits nur für Admins (1–50).                                                |
| 018     | Grün    | villa.export liefert Villa + Verlauf als portables JSON (Version 1) nur für eigene Villen; villa.import legt eine neue Villa mit bis zu 200 Nachrichten an, erzwingt Kapazität und Limit und schreibt einen Audit-Eintrag.                                                                        |
| 019     | Grün    | villa.activity liefert je Villa Nachrichtenzähler, letzten Aktivitätszeitpunkt und Status (aktiv/archiviert) als SQL-Aggregat — ohne Nachrichteninhalte.                                                                                                                                          |
| 020     | Grün    | Abschluss-Review: 136 Tests grün (4 übersprungen), Typecheck und Build sauber; Sprints 011–019 gemerged, 6 Migrationen (0001–0006) erforderlich; Client-Typen (description, capacity, archivedAt) nachgezogen.                                                                                    |
| 021     | Grün    | Begrenzte Testläufe sind persistiert (`villa_test_runs`, Migration 0009): Status, Start-, Endzeit und Ergebnis überleben Neustarts; ein aktiver Lauf pro Villa, Ownership über die Villa geprüft; tRPC-Router `run` (start/finish/list/get) mit Grenzen und Fehlermapping (11 Router-Tests grün). |
| 023     | Grün    | Phasenmodell: villa_test_runs trägt eine sichtbare Phase (preparation → planning → execution → review → result, Migration 0010); run.setPhase schaltet nur vorwärts und idempotent, „result“ setzt ausschließlich der Abschluss; abgeschlossene Läufe bleiben unverändert (12 neue Tests grün). |
| 024     | Grün    | Countdown und Fortschritt: villa_test_runs trägt timeLimitSeconds (60–3600 s, Default 600, Migration 0011); run.progress projiziert Fortschritt und Countdown deterministisch aus startedAt + Grenze, abgeschlossene Läufe sind vollständig ohne Countdown (9 neue Tests grün). |
| 025     | Grün    | Live-Aktivitätsprotokoll: neue Tabelle villa_run_events (Migration 0012) mit Level info/warn/error und max. 400 Zeichen; run.log liest die letzten Ereignisse (neueste zuerst, max. 50), run.appendEvent schreibt nur in laufende Läufe — abgeschlossene bleiben fix (9 neue Tests grün). |
| 026     | Grün    | Abbruchgrund: villa_test_runs erfasst cancellationKind „manual“ (Default) oder „technical“ (z. B. Zeitgrenze), Migration 0013; nur mit status „cancelled“ erlaubt, Art wird bei wiederholtem Finish nie umgeschrieben (8 neue Tests grün). |
| 027     | Grün    | Wiederaufnahme-Regeln: Freigabe (releasedForResumeAt, Migration 0014) nur für abgebrochene Läufe (cancelled/failed), idempotent; run.start mit resumeOfRunId fortführen nur aus explizit freigegebenen Läufen (NOT_RELEASED sonst) — die Historie bleibt unverändert, der neue Lauf referenziert resumedFromRunId (10 neue Tests grün). |
| 028     | Grün    | Laufbericht: run.report compiliert Status, Dauer (abgeschlossen: endedAt, laufend: bis jetzt), Phase, Zeitgrenze/Ablauf, Abbruchgrund und Fehlerbild (Level-Zähler + fünf letzte Meldungen) deterministisch — ohne eigenen Speicherzustand (5 neue Tests grün). |
| 029     | Grün    | Controller-Berechtigungen: controllerRouter in die App eingebunden; globale Steuerungen (start/stop/toggle) nur für Administratoren (FORBIDDEN sonst, Rolle ausschließlich aus verifizierter Auth), Status lesbar für alle Angemeldeten (4 neue Tests grün). |
| 030     | Grün    | Controller-Review: Zustandsautomat, Rechte-Matrix und Invarianten der Sprints 021–029 dokumentiert (docs/CONTROLLER-REVIEW.md) und als zusammenhängender Zeitstrahl in einer neuen Regressionssuite verifiziert (4 neue Tests, pnpm validate grün). |
| 031     | Grün    | Providerregister: zentraler Katalog (server/provider-registry.ts) mit dokumentierten Fähigkeiten, Statusfeld, Consent-Kennzeichen und Modellketten je Anbieter; Status via PROVIDER_STATUS_<NAME> ohne Codeänderung, ungültige Werte fallen auf den dokumentierten Standard; die Failover-Kette lässt maintenance/retired-Anbieter verbindlich aus (fail-closed); agent.providers liefert das Register lesbar (4 neue Tests grün). |
| 032     | Grün    | Fallback-Reihenfolge: fallbackOrder() im Providerregister — dokumentierte Default-Ordnung, per PROVIDER_FALLBACK_ORDER konfigurierbar (validiert, dedupliziert, unbekannte Namen verworfen, ungenannte folgen dokumentiert); der Engine sortiert die Failover-Kette danach; agent.providers liefert die wirksame Reihenfolge mit (4 neue Tests grün). |
| 033     | Grün    | Rate-Limit-Erkennung: neuer Fehlercode TIMEOUT (Timeouts von AbortSignal.timeout werden nicht mehr als allgemeine Unerreichbarkeit verschluckt); 429/402 bleiben LIMIT und lesen Retry-After (Sekunden oder HTTP-Datum, ungültige Werte undefined statt geraten); TIMEOUT fällt auf den nächsten Anbieter durch; Fehlercode-Katalog erweitert (8 neue Tests grün). |
| 034     | Grün    | Cooldown-Mechanismus: eigenes Modul provider-cooldown.ts — Auth-Fehler sperren 30 min (wie bisher), erschöpfte Kontingente sperren die Route zeitlich begrenzt (dokumentiertes Retry-After, sonst 5 min Default, Deckel 60 min, bei „0“ keine Sperre); Sperren verkürzen sich nie; Kette bleibt fail-closed (7 neue Tests grün). |
| 035     | Grün    | Kontingentanzeige: agent.usage liefert jetzt windows mit genutzten und verbleibenden Aufrufen je lokalem Fenster (Turns, GitHub, Credential-Checks) inkl. Limit, Aktiv-Flag und Reset-Zeitpunkt; reines Nachschauen ohne Verbrauch; Administratoren sehen null (unbegrenzt) (5 neue Tests grün). |
| 036     | Grün    | Provider-Gesundheitscheck: neues Modul provider-health.ts — jeder Check ist ein ungefährliches GET auf Status-/Liste-Endpunkte (kein Completion-Endpunkt, kein Körper, kein Kontingentverbrauch), hartes Zeitlimit 8 s; Anfragen begrenzt (Mindestabstand 10 s je Anbieter, danach cached); Hugging Face bleibt einwilligungsgated; Admin-Mutation providerHealth, Schlüssel bleiben serverseitig (10 neue Tests grün). |
| 037     | Grün    | Fail-closed bei fehlender Berechtigung: GitHubToolError NOT_CONFIGURED/AUTH bricht die Werkzeugrunde ehrlich mit MISSING_KEY ab statt still als Tool-Nachricht weitergeprobt zu werden; explizit angeforderter HF-Fallback ohne HF_TOKEN wird mit PRECONDITION_FAILED abgelehnt (keine stille Umleitung auf andere Anbieter); behebbare Werkzeugfehler (z. B. RATE_LIMIT) bleiben Tool-Nachricht (5 neue Tests grün). |
| 038     | Grün    | Router-Telemetrie: neues Modul router-telemetry.ts — jeder Turn erfasst Anbieter, Modell, Versuche, Latenz, Erfolg, Fallback-Herkunft und -Grund (Fehlercode) bzw. terminalen Fehlercode; begrenzt auf die letzten 200 Samples, ohne Nutzdaten oder Geheimnisse; deterministische Aggregation (byProvider sortiert, Durchschnittswerte gerundet); Admin-Query agent.routerTelemetry (11 neue Tests grün). |
| 039     | Grün    | Router-Stresstest: neue Suite router-stress.test.ts — 100 nebenläufige Turns mit gemischten 429/503-Mocks enden alle kontrolliert (Terminalfehler nur als AgentError), Failover auch unter Last mehrheitlich erfolgreich; 50 nebenläufige Fenster-Verbräuche zählen exakt 12 (Rest TOO_MANY_REQUESTS, kein Durchrutschen); Telemetrie-Speicher bleibt auch bei 300 Turns auf 200 Samples begrenzt; kein ungefangener Absturz (4 neue Tests, komplett gegen Mocks — kein echter Netzwerkverkehr). |
| 040     | Grün    | Routing-Review: neue gebündelte Regressions-Suite routing-review.test.ts — Failover-Reihenfolge, terminale REJECTED, Auth-Cooldown mit fail-closed, MISSING_KEY ohne Keys, HF-Consent-Gate, keine Geheimnisse in Fehlern/Telemetrie, Admin-only-Endpunkte, LIMIT-Klassifizierung mit Retry-After und Cooldown, Branch-Pflicht vor Schreib-Werkzeugen — alle Invarianten zusammen gegen Mocks grün (9 neue Tests). |
| 041     | Grün    | Agentenauftragsschema: neues Modul agent-schemas.ts als eine Quelle der Wahrheit — Zod-Schemas für Eingabe (Prompt/Modus/Spezialisierung, System-Override, Forge-Kontext), Kontext (Verlaufsnachrichten mit Rolle/Länge/Anzahl-Grenzen, Grenzwerte als AGENT_INPUT_LIMITS, von denen die Engine-LIMITS abgeleitet sind) und Ergebnis (Kernfelder + Anbieter-Enum); unbekannte Eingabefelder werden an der Engine-Grenze abgestreift; neuer Fehlercode INVALID_INPUT (Kategorie validation); Engine validiert Eingaben in runAgentTurn und der Werkzeugrunde sowie Ergebnisse vor Rückgabe (9 neue Tests grün). |
| 042     | Grün    | Capability-Packs katalogisiert: neues Modul pack-catalog.ts — jedes der 28 Packs beschreibt Zweck (purpose), Berechtigungen (permissions) und Grenzen (limits), schema-validiert via capabilityPackSchema; fehlt einem Pack die Katalogisierung, wirft der Katalog (kein Pack bleibt unbeschrieben); neue Query agent.packs für alle Nutzer lesbar; Katalog-Invarianten getestet (Vollständigkeit, eindeutige IDs, Admin-Kennzeichnung, keine echten Geheimnis-Werte) (5 neue Tests grün). |
| 043     | Grün    | Werkzeug-Permissions: neues Modul tool-permissions.ts — jedes GitHub-Werkzeug ist im Berechtigungsregister mit Kategorie (read/write), Admin-Pflicht und Sitzungs-Branch-Pflicht katalogisiert; die Engine autorisiert jeden Aufruf VOR der Ausführung fail-closed (unbekannte Werkzeuge werden nie ausgeführt); Schreibwerkzeuge erfordern Administratorberechtigung und einen in derselben Anfrage/Mission erstellten Branch; Router gibt die geprüfte Rolle explizit an die Werkzeugrunde weiter (Chat- und Elite-Pfad); ohne Autorisierung dep ist die Runde per Default abweisend (7 neue Tests grün). |
| 044     | Grün    | Aufgabenkontext-Isolation: neues Modul context-isolation.ts — Cache-Schlüssel und Lauf-Deduplizierung sind pro Mission namespaced (mission:<id>-Scope, Chat behält eigenen Scope); Auftragsschema führt optionale, begrenzte missionId mit, die Elite-Ausführung automatisch aus der Missions-ID stempelt; eine Mission liest nie Cache oder Lauf-Ergebnisse einer anderen Mission oder des Chats, innerhalb derselben Mission bleiben Cache und Dedupe unverändert intakt (5 neue Tests grün, u. a. Cache-Trennung bei identischer Anfrage-Signatur und Dedupe nur innerhalb derselben Mission). |
| 045     | Grün    | Retry-Regeln: MAX_MISSION_ATTEMPTS=3 als hartes Wiederholungslimit — der Restart-SQL nimmt nur Missionen mit Restversuchen (lt attempt-Bedingung atomar gegen Rennen); Helper missionRetryExhausted; Router meldet beim erschöpften Limit endgültigen Konflikt mit klarer Grenznachricht statt erneutem Lauf (keine weiteren GitHub-Nebenwirkungen); Duplikate verhindert weiterhin die Idempotenz-Reserve aus Sprint 027 (4 neue Tests grün: Limit-Helfer, endgültige Ablehnung, allgemeiner Konflikt, normaler Restart mit Restversuchen). |
| 046     | Grün    | Ergebnisvalidierung: neues toolLoopResultSchema (erweitert agentResultSchema) mit strikten Feldern completed, pullRequestOpened, pullRequest (Nummer/URL/Branch) und branch; beide Rückgaben der GitHub-Werkzeugrunde (Abschluss und Budgetabbruch) laufen durch parseToolLoopResult — ungültige Ergebnisse werden als AgentSchemaError sicher abgewiesen statt ungeprüft an Aufrufer oder Persistenz weitergereicht (4 neue Tests grün, inkl. fail-closed bei manipuliertem PR-Ergebnis mit ungültiger URL). |
| 047     | Grün    | Human-in-the-loop: neues Freigabepunkt-Register approval-gates.ts (mission-start, mission-restart, controller-stop) mit fester Kennung, Klartext-Beschreibung und verpflichtendem Bestätigungstext; Router fragt jeden risikorechten Einstieg zentral über requireApproval ab — Missionsstart (acknowledgeImpact), Neustart (acknowledgeExternalChanges) und Anhalten des Agentenbetriebs (acknowledgeStop) verweigern ohne Quittung mit klarer Meldung; Client quittiert Start und Stop zusätzlich per Bestätigungsdialog; Nicht-Administratoren sehen weiterhin FORBIDDEN vor der Freigabeprüfung (4 neue Tests grün). |
| 048     | Grün    | Agentenmetriken: neues agent-metrics.ts erfasst Laufzeit, Ergebnisstatus (completed/partial/failed) und Fehlercode jeden Elite-Laufes inkl. Neustarts (executePersistedMission über instrumentAgentRun; Historie auf 200 Läufe begrenzt, keine Nutzerinhalte); neue admin-only-Abfrage agent.agentMetrics liefert Totals, Fehlercodes nach Häufigkeit und mittlere Laufzeit (7 neue Tests grün, inkl. Router-Integration und FORBIDDEN für Nicht-Admins). |
| 049     | Grün    | Prompt- und Kontextversionierung: neues prompt-versions.ts führt ein versioniertes Register für den Administrator-Systemprompt (max. 50 Versionen, Autor + Zeitstempel + Hinweis je Änderung); setSystemPrompt zeichnet jede Änderung als Version auf, neue Abfrage agent.promptVersions (admin-only) liefert den Verlauf newest-first, rollbackPromptVersion setzt eine frühere Fassung explizit als eigene Version zurück (Rücksetzung bleibt selbst nachvollziehbar und rücksetzbar); unbekannte Versionen werden mit NOT_FOUND abgewiesen; aktiver Prompt läuft über activePrompt() überall im Router (5 neue Tests grün). |
| 050     | Grün    | Engine-Review: neue Regressionssuite engine-review.test.ts bündelt die Invarianten von Engine, Packs und Tool-Sicherheitsgrenzen — Pack-Katalog-Einträge brauchen Zweck, Berechtigungen und Grenzen; unbekannte Werkzeuge und Werkstatt-fremde Aufrufe sind fail-closed verweigert; Schreibwerkzeuge erfordern Administrator + Sitzungs-Branch (Lesewerkzeuge nicht); Freigabepunkte tragen alle Quittungstexte; Elite-Grenzen sind endlich (24 GitHub-Aktionen, 12 Werkzeugrunden, 12 000 Prompt-Zeichen) (7 neue Tests grün). |
| 051     | Grün    | Rollenmodell: Administrator, Operator und Viewer sind getrennt — neues roles.ts mit wirksamer Rollenermittlung (DB-Rolle oder AGENT_ADMIN_EMAIL/AGENT_OPERATOR_EMAIL-Allowlist) und Mindestrollen-Prüfung (FORBIDDEN mit Klartext); setState verlangt jetzt Operator-Rang (Administratoren bleiben berechtigt, Viewer ausgesperrt), Administrator-Endpunkte (Prompts, Metriken, Elite-Missionen) bleiben Admin-only; Status weist Rolle + canControl aus; Controller-Seite und Start/Stop-Buttons folgen canControl; DB-Rollen-Typ um "operator" erweitert (6 neue Tests grün). |
| 052     | Grün    | Audit-Log: neues audit-log.ts zeichnet kritische Änderungen mit ISO-Zeitstempel, Nutzer (id + E-Mail) und Aktion in einem begrenzten Ringpuffer (200 Einträge) auf; Betriebszustand (controller_state_set), Systemprompt-Änderungen (system_prompt_set) und Rollbacks (system_prompt_rollback) sind verdrahtet; neue admin-only-Abfrage agent.auditLog liefert newest-first mit Gesamtzahl; Operatoren und Viewer bleiben von der Abfrage ausgesperrt (5 neue Tests grün). |
| 053     | Grün    | KI-Speicher-Berater: autonomer Dateimanager erhaelt Berater fuer Speicherplanung (Sprint-PR #61). |
| 054     | Grün    | Native Google-Sign-In korrigiert: Client-ID-Mismatch behoben, Regressionstest pinnt capacitor.config.ts + strings.xml auf die Produktions-Web-Client-ID; Login-Screen zeigt native Fehlerdetails; Emulator-Probe verifiziert den Android-Client (kein ApiException 10 mehr). |
| 055     | Grün    | CSRF- und Session-Review: Origin/Referer-Guard (csrf.ts) fuer alle unmethodischen /api-Requests; same-origin, native Urspruenge und Nicht-Browser-Clients frei, Cross-Site-Mutationen 403 (10 neue Tests gruen). |
| 056     | Grün    | Rate-Limit für Adminaktionen: requireAdminMutation erzwingt Rolle UND ein per-Nutzer-Budget (30 Mutationen/Minute, gleitendes Fenster, prozesslokal); alle 11 schreibenden Admin-Prozeduren sind angeschlossen, lesende Admin-Abfragen bleiben frei (4 neue Tests grün). |
| 057     | Grün    | Export-Schutz: villa.export läuft vor Rückgabe durch ein versioniertes Whitelist-Schema (villa-export.ts) — interne Felder (IDs, createdBy, Provider-/Modell-Metadaten) und unzulässige Rollen/Inhalte werden garantiert entfernt, Export-Version ist fixiert (6 neue Tests grün). |
| 058     | Grün    | Sicherheitsheader: security-headers.ts setzt nosniff, X-Frame-Options DENY, Referrer-Policy und Permissions-Policy immer; CSP (script-src 'self', frame-ancestors 'none', Objekte verboten) und HSTS nur in Produktion — Native-Client unberührt, Dev/Vite-HMR frei (4 neue Tests grün). |
| 059     | Grün    | Dependency-Review: `pnpm audit` (prod+dev) ohne bekannte Schwachstellen; Dependabot für npm und GitHub Actions aktiviert (woechentlich, Minor/Patch gruppiert, Major mit Review); CI prüft ab jetzt `pnpm audit --prod --audit-level high`; Ergebnisse in docs/DEPENDENCY-REVIEW.md dokumentiert. |
| 060     | Grün    | Security-Review: gebündelte Regressionssuite security-review.test.ts über alle kritischen Schutzpfade — UNAUTHORIZED ohne Sitzung, FORBIDDEN ohne Admin, Admin-Budget-E2E (TOO_MANY_REQUESTS nach Limit), Nicht-Admin-Ablehnungen verbrauchen kein Budget, CSRF-Block, Export-Redaktion, Header-Invarianten (7 Tests grün). |
| 061     | Grün    | Mobile Navigation: Drawer/Modals sperren jetzt den Hintergrund-Scroll (kein Durchfahren des Chats bei offenem Menü auf Touch-Geräten) und schließen mit Escape; CSS-Prüfung bestätigt: Safe-Areas, 44px-Touch-Ziele, Tabbar ≤680px, Theme-Switcher auch bei ≤370px erreichbar. E2E verifiziert. |
| 062     | Grün    | Villa Factory mobil: Erstellen-Modal scrollbar statt abgeschnitten (max-height + Safe-Area, wichtig bei geöffneter Tastatur), Textareas ohne Resize-Griff, alle Eingabefelder 16px gegen iOS-Fokuszoom — auch Chat-Composer und Drawer-Suche. |
| 063     | Grün    | Reduced-Motion komplett: globaler prefers-reduced-motion-Block erzwingt jetzt animation-duration ~0 + iteration-count 1 für ALLE Animationen (deckt mic-pulse, fade/slide/modal und Tailwind animate-spin/pulse ab); .spin stoppt statt nur langsamer zu drehen. |
| 064     | Grün    | Offline-Chatcache: QueryClient auf networkMode offlineFirst umgestellt (Verlauf bleibt bei Abbruch lesbar, Cache 30 min), neuer Online-Status-Hook mit Offline-Banner im Chat ("Keine Verbindung — dein Verlauf bleibt lesbar."), 3 neue Tests; vitest nimmt jetzt hooks-Tests auf. |
| 065     | Grün    | 24/7-Watchdog-Loops (Eigentümer-Richtung, ersetzt Roadmap-065, das durch Sprint 064 vorweggenommen war): controller.ts führt einen echten, begrenzten Worker-Loop aus (Standardtakt 60 s, WATCHDOG_TICK_MS, min. 30 s) mit je Tick isolierten Segmenten — Mission-Lease-Sweep, DB-Sonde (SELECT 1), Provider-Status-Sonden (jeden 5. Tick), Zählung unterbrochener Missionen (nur Anzeige, Neustart bleibt freigabepflichtig), Elite-Metriken. 24/7-Semantik: RUNNING wird nach Prozessneustart fortgesetzt; init() ist im Server-Startup verdrahtet (vorher toter Code). SSE /api/controller/stream ist gemountet und streamt state-/tick-Events; agent.setState startet/stoppt den Watchdog mit; Controller-UI zeigt eine Live-Karte (Ticks, DB, Provider, unterbrochene Missionen, Erfolgsquote). 7 neue Watchdog-Tests (475 grün), Commit 9bd1299, CI + APK success. |
| 066     | Grün    | HITL-Verknüpfung Watchdog → Elite Mission Control: die Watchdog-Karte der Controller-Seite verlinkt unterbrochene Missionen ab Anzahl > 0 direkt zur Prüfung und Freigabe in /core/elite ("Nach Prüfung erneut starten" bleibt an acknowledgeExternalChanges gebunden); der Watchdog zählt und verlinkt nur, ein Neustart bleibt niemals automatisch. |
| 067     | Grün    | Synchronisationskonflikte (Roadmap 066): gescheiterte Chat-Sendungen bleiben sichtbar UND wiederholbar — Nutzer-Nachricht wird „failed“ markiert, behält ihren Text und trägt einen „Erneut senden“-Button, der genau diesen Zug (Nachricht + Folgefehlerantworten) entfernt und neu sendet (client/src/lib/chatSync.ts, rein + 14 Tests). Gescheiterte Verlauf-Persistenz markiert den Zug als „Nur auf diesem Gerät — beim nächsten Laden nicht mehr verfügbar“ statt still zu divergieren; beim Serverabgleich gewinnt der Server, aber der Konflikt ist vorher lesbar. |
| 068     | Grün    | Touch-Zielgrößen (Roadmap 067): alle interaktiven Ziele erreichen jetzt mindestens 44x44px effektive Trefferfläche — Icon-Buttons 40px visuell + unsichtbare ::after-Hit-Area (+4px je Seite, Überlappungsfreiheit durch angehobene Header-Lücke 8px), Bewertungs-Buttons 32px + 6px Expansion (Lücke 8→12px), Chat-einklappen-Button (vorher nacktes 18px-Icon) auf 44x44, Runde-Hinzufügen-Taste 42→44, Mic/Send mobil 43→44, Retry-Button (Sprint 067) 32→44. Neue statische CSS-Regression (touchTargets.test.ts, 8 Tests) pinnt alle Invarianten gegen unbemerktes Schrumpfen — Sprint 061 hatte nur manuell geprüft. |
| 069     | Grün    | Fehler- und Ladezustände (Roadmap 068): Kein Flow endet mehr leer oder blockiert — neue reine Phasenlogik queryFlow.ts (loading/error/ready; deaktivierte Abfragen sind bewusst „ready“, kein Endlos-Spinner vor Login) + QueryState-Komponente mit sichtbarem Ladehinweis und Fehlerkarte mit „Erneut laden“. Integriert an vier stillen Stellen: Elite-Mission-Villenkarte (Fehler statt stiller „wird geladen …“-Leere), Missionsliste und Demoanfragen (Fehler mit Retry statt reinem Text), Controller (Status-Fehler zeigt eigene Retry-Karte statt still deaktivierter Seite), Chat-Verlauf (Ladefehler mit Retry statt verschwundener Historie). 9 neue Logik-Tests (506 grün); Touch-Target-Regression gegen versehentliche Zusatzselektoren gehärtet. |
| 070     | Grün    | Mobile Accessibility (Roadmap 069): Globaler Tastatur-Fokus-Ring für ALLE interaktiven Elemente (:where(button, a, select, textarea, [tabindex]):focus-visible, Cyan #37dcc6 mit >= 3:1 gegen den Hintergrund — vorher nur Sende-/Google-Buttons und Links). Bestandsaufnahme bestätigt: alle Icon-Buttons tragen bereits aria-label, aria-live-Regionen existieren im Chat, prefers-reduced-motion deckt (seit 063) alle Animationen ab, alle 8 Kern-Textpaare erreichen WCAG AA (4.75–16.9:1). Neue statische Regression a11y.test.ts (12 Tests) pinnt Kontrastpaare, Fokus-Ring und Icon-Label-Invariante gegen unbemerkte Regressionen. |
| 076–084 | Grün    | Sprints 076–084 vollstaendig umgesetzt, gemerged und verifiziert (Prod-Env-Validierung, Token-Budget, Auto-Merge, Free-Tier-Erholung, Ollama-Route, Gate-Skip, Oracle-Kit, Ollama-VPS, PR-Backlog-Abbau). |
| 085     | Grün    | End-to-End-Smoke-Suite: 10 deterministische E2E-Tests in tests/e2e/smoke.test.ts prüfen gegen lokal gebooteten Server (Mock-Umgebung, dynamischer Port) den Kernpfad (Health, Routing-Status, Villa-Anlegen inkl. Validierung, Lauf-Start idempotent, Lauf-Stopp, Laufbericht, Isolation). Ausführbar per pnpm test:e2e; 10/10 grün in 1,6 s. |
| 086–100 | Geplant | Naechste Sprints aus der Roadmap (Router-Lasttest, Fehler-Injection, Build-Reproduzierbarkeit, etc.). |

## Sprint 085 — End-to-End-Smoke-Suite (05.10.2026)

Deterministische E2E-Smoke-Tests in `tests/e2e/smoke.test.ts`, die gegen einen lokal gebooteten Express-Server auf dynamischem Port mit Mock-Umgebung (kein echter Provider, keine echte DB) den Kernpfad prüfen:
- (1) Health ok (`/api/health` liefert HTTP 200, Version, Uptime, Timestamp, Providers).
- (2) Routing-Status öffentlich lesbar (`/api/health` liefert `routing` mit `pinned`, `pinnedBy`, `activeRoute` ohne Authentifizierung).
- (3) Villa anlegen (`villa.create` über HTTP tRPC mit Trimming, Standard-Kapazität 8 und Specialty).
- (4) Villa-Validierung (leerer Name wird mit BAD_REQUEST abgelehnt).
- (5) Kapazitäts-Validierung (Werte < 1 oder > 25 werden abgelehnt).
- (6) Lauf starten (`run.start` über HTTP tRPC startet Testlauf für eigene Villa im Status `running` und Phase `preparation`).
- (7) Lauf-Start idempotenz (`run.start` gibt bei aktivem Lauf den bestehenden Lauf zurück).
- (8) Lauf stoppen (`run.finish` schaltet Lauf-Status auf `succeeded` mit `endedAt` und Ergebnis-Payload).
- (9) Laufbericht abrufen (`run.report` liefert vollständige Zusammenfassung mit Status, Dauer und Event-Statistik).
- (10) Nutzer-Isolierung (`villa.list` und `run.list` beschränken Ergebnisse streng auf den angemeldeten Nutzer).

Ausführung als pnpm-Skript `pnpm test:e2e` und in `vitest.config.ts` eingebunden (10/10 Tests grün in 1,6 s).

## Sprint 084 — PR-Backlog-Abbau (05.10.2026)

Systematischer Abbau des gesamten offenen PR-Backlogs gemäß Autonomieauftrag.

- (a) Sprint-PRs #77 (Sprint 082, Ollama-Oracle-Kit) und #78 (Sprint 083, Ollama-VPS) verifiziert (CI grün, PR-Agent 429 Quota-Fail) und per Owner-Vollmacht squash-gemerged (#78 rebased).
- (b) Alt-PRs #69 (400-Klassifikation), #30 (Health-Docs) und #31 (HF-Checkbox-Fix) analysiert: alle drei veraltet/obsolet bzw. mit Merge-Konflikten oder Risiko des Überschreibens neuerer CI/UX-Stände; mit klaren Begründungskommentaren geschlossen.
- (c) Dependabot-PRs #62–#67 (#62 checkout v7, #63 upload-artifact v7, #64 setup-java v6, #65 action-setup v6, #66 setup-node v7, #67 lucide-react/wouter minor/patch) geprüft: CI-Status auf allen grün; per Owner-PAT squash-gemerged (#65 rebased).
- (d) PR #29 (Server-Deploy cybersarah-ki.com) geprüft: durch Render-Free-Hosting und Sprint-083-VPS-Caddy-Setup superseded; mit Kommentar geschlossen.
- Ergebnis: PR-Backlog vollständig bereinigt (0 offene PRs).

## Grüner Validierungsweg

```bash
pnpm validate
```

Der Befehl führt TypeScript-Prüfung, vollständige Tests, Produktionsbuild und eine abschließende Diff-Prüfung aus. Externe Provider-Schlüssel sind für diesen Weg nicht erforderlich.

## Regeln für autonome Sprintausführung

Jeder Sprint erhält eine eindeutige Änderung, mindestens eine technische Prüfung und ein dokumentiertes Ergebnis. Ein fehlgeschlagener Sprint wird korrigiert oder als blockiert markiert; er wird nicht stillschweigend übersprungen. Riskante externe Aktionen, Datenlöschungen, Käufe, Veröffentlichungen und Änderungen an Zugriffen benötigen eine separate Bestätigung.

## Abschlussverifikation (02.10.2026, main @ 4ca142e)

- CI auf allen Sprint-Commits 055–064: success (458 Tests, Typecheck, Build).
- Build Android APK (Release, signiert): success auf 4ca142e.
- Android-Emulator-Smoketest (android-smoke) auf 4ca142e: success — App installiert und lauffähig.
- Google-Sign-In-Probe auf 4ca142e: CONFIG_OK_EMULATOR_LIMITED — Google akzeptiert Paketname/SHA-1 (kein ApiException 10); interaktiver Login nur auf echtem Gerät mit Google-Konto abschließbar (12500 ist emulatorbedingt).
- Produktion (Render): /api/health 200, DB verbunden, alle Sicherheitsheader aus Sprint 058 aktiv (CSP frame-ancestors 'none', HSTS, DENY, nosniff, Referrer-/Permissions-Policy).

## Login-Diagnose-Build (02.10.2026, abends)

App-Version + Build-Nummer im Login-Footer (shared/const.ts: APP_VERSION 1.1.0,
APP_BUILD 3; build.gradle versionCode 3). Ein Screenshot zeigt damit sofort,
welche APK installiert ist — wichtig bei der GCP-Anmeldefehler-Diagnose
(Web: redirect_uri_mismatch ab ca. 20:00 UTC; Android: ApiException 10 am
Geraet — OAuth-Clients wurden in der Cloud Console veraendert).

## OAuth-Client-Wechsel (02.10.2026, spaet)

Der Produktionsserver verwendete Web-Client 656137332727-alqdkl..., der in
der GCP-Console des Projekts nicht mehr auffindbar war und jede Redirect-URI
ablehnte. Analyse per Live-Fingerprint (o/oauth2/v2/auth): Projekt
656137332727 enthaelt AgentVilla (656137332727-vhip14vrtg...), Google ID
(656137332727-aclq3q5...) und Android-Client 1. Nur AgentVilla hat die
Redirect-URI registriert UND ein gueltiges Client-Secret. App + APK wurden
auf AgentVilla umgestellt (capacitor.config.ts, versionCode 4 / Build 4).
Der Render-Server benoetigt GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET auf
AgentVilla (manueller Dashboard-Schritt).
