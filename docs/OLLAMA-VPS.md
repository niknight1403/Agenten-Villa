# Ollama-Anbindung: Hetzner-VPS CyberSarah-pro (Sprint 083)

Owner-Entscheid (04.10.2026): Ollama bleibt auf dem VPS, wo es bereits
läuft (Status dort: `Ollama is running`, Modelle `qwen2.5-coder:1.5b`,
`tinyllama:latest`). Kein Umzug auf Oracle/Spaces — die Villa wird mit
dem bestehenden Ollama verbunden.

## Was schon stimmt

- Ollama läuft auf dem VPS als Dienst und lauscht auf `127.0.0.1:11434`.
- nginx läuft auf dem VPS und terminiert bereits TLS für CyberSarah-Domains.
- Die Villa-Route (Sprint 080) erwartet nur `OLLAMA_BASE_URL` + optional
  `OLLAMA_API_KEY` — OpenAI-kompatibel.

## Schritt 1: DNS (Owner)

Einen A-Record setzen: `ollama.cybersarah-ki.com → <VPS-IPv4>`
(TTL 300). DNS bleibt bewusst Owner-Sache.

## Schritt 2: TLS-Proxy + Token auf dem VPS (ein Skript-Aufruf)

Das Bootstrap-Skript aus `ops/ollama/` ist bewusst generisch gehalten
(Ubuntu/Debian, x86_64 oder ARM) und richtet nginx als token-geschützten
TLS-Reverse-Proxy — Ollama selbst bleibt fest auf 127.0.0.1:

```bash
git clone --depth 1 https://github.com/niknight1403/Agenten-Villa.git /tmp/villa
cd /tmp/villa/ops/ollama
export OLLAMA_DOMAIN=ollama.cybersarah-ki.com
export OLLAMA_TOKEN=$(openssl rand -hex 32)   # Token notieren!
export OLLAMA_CERTBOT_EMAIL=deine@email.de
# NICHT die 27b-Defaults ziehen — RAM erst pruefen (free -h):
export OLLAMA_MODELS_INSTALL=""               # vorhandene Modelle behalten
./setup-oracle-free.sh
```

Falls die Modell-Liste erweitert werden soll (nach `free -h`):
- ≥ 16 GB RAM: `export OLLAMA_MODELS_INSTALL="gemma4:12b"`
- ≥ 24 GB RAM: zusätzlich `devstral:24b`, dann `qwen3.6:27b`
- `qwen3-coder:30b` nur per `OLLAMA_INCLUDE_30B=true` bei ≥ 32 GB RAM.

## Schritt 3: Render-Env (Owner, Dashboard)

Am Agenten-Villa-Service in Render setzen:
- `OLLAMA_BASE_URL=https://ollama.cybersarah-ki.com/v1`
- `OLLAMA_API_KEY=<Token aus Schritt 2>`
- `OLLAMA_MODELS=qwen2.5-coder:1.5b,tinyllama:latest`
  (oder die erweiterte Liste; die Kette nutzt sie in dieser Reihenfolge,
  Fallback auf die Cloud-Kette bleibt intakt)

## Schritt 4: Verifikation (Agent)

Sobald der Endpoint steht, prüft der Agent:
1. `GET /v1/models` mit Token → Modellliste
2. Villa-Health auf `ollama: configured`
3. Ein Agenten-Turn antwortet mit `provider: "ollama"`

## Ehrliche Einordnung

- Der VPS steht im Hetzner-Exit-Plan auf der Dekommissions-Liste (Phase 6).
  Diese Anbindung ist bewusst so gebaut, dass sie mitzieht, wenn der
  Ollama-Host später wechselt: Es ändert sich nur `OLLAMA_BASE_URL`.
- Die beiden vorhandenen Modelle sind klein und schwach — für echte
  Agentenarbeit sind `gemma4:12b`+ zu empfehlen, sobald der RAM es hergibt.
- CPU-Inferenz auf dem VPS ist langsam; die Route hat ihr eigenes
  Zeitlimit (`OLLAMA_TIMEOUT_MS`, Default 120 s) und fällt bei Timeout
  ehrlich auf die Cloud-Kette zurück.
