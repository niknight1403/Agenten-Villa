# Ollama auf Oracle Cloud Always Free — Setup für die Agenten-Villa (Sprint 082)

Ziel: Die lokale Ollama-Route (Sprint 080) läuft dauerhaft kostenlos auf einer
eigenen VM statt auf dem auszulösenden Hetzner-VPS. Oracle Cloud Always Free
bietet **dauerhaft** (nicht nur Testphase) eine ARM-VM mit 4 OCPUs und 24 GB
RAM sowie 200 GB Block-Storage — die einzige wirklich kostenlose 24/7-Option,
die groß genug für unsere Modellkette ist.

## RAM-Einordnung (ehrlich)

| Modell | Q4-Größe | Auf 24 GB RAM |
|---|---|---|
| gemma4:12b (Allrounder) | ~8 GB | sauber lauffähig |
| devstral:24b (Agenten-Spezialist) | ~14 GB | sauber lauffähig |
| qwen3.6:27b (Coding-Experte) | ~17 GB | passt knapp |
| qwen3-coder:30b | ~19 GB | grenzwertig, opt-in |

CPU-Inferenz (ARM) ist **langsam**: Minuten pro Antwort, nicht Sekunden.
Deshalb hat die Route in der Villa ihr eigenes Zeitlimit (`OLLAMA_TIMEOUT_MS`,
Default 120 s, max 600 s). Die Cloud-Kette springt bei Timeout ehrlich als
Fallback ein — kostenlos, wenn Zeit keine Rolle spielt.

## Schritt 1: Oracle-Konto + VM (Owner, einmalig)

1. https://cloud.oracle.com → „Start for free“. Kreditkarte nur zur
   Verifizierung, **keine Abbuchung**; Always-Free-Ressourcen bleiben bei
   Testende erhalten („Upgrade“ NICHT nötig — dann würde es kostenpflichtig).
2. Compute → Instances → Create instance:
   - **Shape:** VM.Standard.A1.Flex, 4 OCPUs, 24 GB RAM
   - **Image:** Ubuntu 22.04 (aarch64) oder 24.04
   - **Boot volume:** auf 100 GB vergrößern (Modelle ~39 GB, Reserve)
   - SSH-Key: neues Key-Paar, Private Key sicher aufbewahren
3. Nach Erstellung: Public-IP notieren (bei „Always Free“ reserviert bleiben).
4. **Virtual Cloud Network → Security List:** Ingress-Regel für TCP 443
   (und 22) von 0.0.0.0/0 ergänzen.
5. **DNS:** bei deinem Anbieter einen A-Record setzen, z. B.
   `ollama.cybersarah-ki.com → <Public-IP>` (TTL niedrig, z. B. 300).

## Schritt 2: Bootstrap auf der VM (ein Befehl)

```bash
ssh -i <key> ubuntu@<Public-IP>
sudo apt-get update && sudo apt-get install -y git
# Skript aus dem Repo holen (read-only genügt):
git clone --depth 1 https://github.com/niknight1403/Agenten-Villa.git /tmp/villa
cd /tmp/villa/ops/ollama
export OLLAMA_DOMAIN=ollama.cybersarah-ki.com
export OLLAMA_TOKEN=$(openssl rand -hex 32)   # Token notieren!
export OLLAMA_CERTBOT_EMAIL=deine@email.de
./setup-oracle-free.sh
```

Das Skript ist idempotent: installiert Ollama (arm64) als systemd-Dienst auf
`127.0.0.1:11434`, zieht die Modelle (klein zuerst), richtet nginx als
TLS-Proxy mit Bearer-Token-Schutz (Let's Encrypt) und öffnet Port 443.

Verifikation auf der VM:
```bash
curl -H "Authorization: Bearer $OLLAMA_TOKEN" https://$OLLAMA_DOMAIN/v1/models
```

## Schritt 3: Render-Anbindung (Agent benachrichtigen)

Im Render-Env des Villa-Services setzen:
- `OLLAMA_BASE_URL=https://ollama.cybersarah-ki.com/v1`
- `OLLAMA_API_KEY=<dein Token>`

Danach prüft der Agent `/api/health`: die Route muss `ollama: configured`
zeigen, und der erste Agenten-Turn sollte mit `provider: "ollama"` antworten.
Sicherheit: Ollama lauscht nur auf localhost, öffentlich hängt ausschließlich
der token-geschützte TLS-Proxy.

## RAM-Diagnose & Native-Modus (Sprint 103, 10.10.2026)

Messwerte von der VM (per Token-Proxy, ohne SSH):

| Modell | Disk | Befund |
|---|---|---|
| gemma4:12b | 8,0 GB | laeuft; ~200 s pro Antwort (ARM-CPU), Kontext 4096 |
| devstral:24b | 14,3 GB | laedt nur langsam (Kaltladen >300 s) |
| qwen3.6:27b | 17,8 GB | Default-Kontext **262.144** Tokens — llama-server startet bei 24 GB RAM nicht (500 nach ~300 s, Ollama-Ladebudget 5 min). Mit `num_ctx=2048` laedt und antwortet es bewiesen (Kaltversuch 1: 500/304 s; Page-Cache-warm Versuch 2: **200/209 s**, danach 17,85 GB resident) |

Konsequenzen (im Villa-Backend umgesetzt, Commit "Sprint 103"):

- Die Villa spricht Ollama jetzt nativ ueber `/api/chat` statt `/v1/chat/completions`: nur dort sind `options.num_ctx` (KV-Cache, Env `OLLAMA_NUM_CTX`, Default 2048, begrenzt 512–8192) und `keep_alive` (Env `OLLAMA_KEEP_ALIVE`, Default 30 m — Modell bleibt resident, Kaltladekosten amortisieren sich im 24/7-Betrieb) pro Anfrage steuerbar.
- Thinking-Felder (`message.thinking` / `reasoning`) werden bewusst NICHT als Antwort gewertet — eine nur denkende Antwort ist ehrlich leer und fuehrt zum naechsten Modell.
- Erste Kaltladeversuche der grossen Modelle koennen Ollamas internes 5-Minuten-Budget sprengen (HTTP 500) — der Router stuft 5xx als UNAVAILABLE ein und faehrt ehrlich mit der Kette fort (gemma4 zuerst).
- Ohne SSH bleiben `OLLAMA_LOAD_TIMEOUT`, `OLLAMA_KV_CACHE_TYPE` (q8_0) und Swap-Konfiguration Owner-Handoffs; per OCI-API waeren sie (Security-List/Neustart) indirekt beeinflussbar.

## Betrieb & Grenzen

- **Kosten:** 0 EUR — Always Free gilt dauerhaft; 3.000 OCPU-Stunden/Monat
  = 4 Kerne rund um die Uhr. Überschreitung ist auf Free-Konten gecappt
  (keine Nachberechnung möglich).
- **Kettenreaktion:** Fällt die VM aus, fällt die Villa ehrlich auf die
  Cloud-Kette zurück (Cooldown + Fallback aus Sprint 079/080) — kein Ausfall.
- **Vorsicht bei Quota-Konten:** Oracle fordert gelegentlich eine
  Kapazitäts-Warteschlange für A1-Instanzen („Out of capacity“) — erneut
  versuchen oder instanz-los warten.
- **Keine Secrets im Repo:** Token lebt nur auf der VM und im Render-Env.
