# Kostenlose lokale Ollama-CPU-Route für Agenten-Villa

Diese Konfiguration startet **Ollama lokal auf einem eigenen Linux-Server** und bindet die API **nur an 127.0.0.1**. Dadurch wird der unauthentifizierte Ollama-Endpunkt nicht direkt ins Internet geöffnet.

## Voraussetzungen

- Linux ARM64 oder AMD64 mit Docker Engine und Docker Compose v2
- Mindestens 8–12 GB RAM für kleine 1,5B–3B-Modelle auf CPU; mehr RAM für größere Modelle
- Ein vorhandener Server, z. B. eine tatsächlich zugeteilte Oracle Always Free ARM-VM
- Persistenter Speicher für Modellgewichte; kostenloses Kontingent beachten

## Start

```bash
cd infra/ollama-cpu
docker compose up -d
docker compose exec ollama ollama pull qwen2.5:1.5b
curl --fail http://127.0.0.1:11434/api/tags
```

Test einer Completion:

```bash
curl --fail http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:1.5b","messages":[{"role":"user","content":"Hallo!"}]}'
```

## Agenten-Villa anbinden

Auf **demselben Rechner** kann das Backend diese Umgebungsvariablen nutzen:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODELS=qwen2.5:1.5b
OLLAMA_TIMEOUT_MS=120000
```

`OLLAMA_API_KEY` ist für eine lokale, ungeschützte Loopback-Verbindung **nicht erforderlich**.

**Bei einem getrennten Backend (z. B. Render)** darf nicht `127.0.0.1` als Ollama-Adresse eingetragen werden: das wäre Render selbst. Benutze dann ausschließlich eine abgesicherte private Verbindung oder einen HTTPS-Reverse-Proxy mit Authentifizierung, Rate-Limits und Zugriffskontrolle. Trage dessen URL und Token als Server-Secrets ein. Niemals Port 11434 ohne Authentifizierung öffentlich freigeben.

## Grenzen

Dies stellt einen reproduzierbaren Deployment-Bauplan bereit, **keine bereits bereitgestellte Cloud-VM**. Oracle Always Free hat Kapazitäts- und Kontingentgrenzen; GPU ist nicht Teil dieser kostenlosen CPU-Konfiguration. Modelle haben Speicher- und Kontextgrenzen. Externe kostenlose API-Anbieter können Rate-Limits erzwingen. Der LLM-Router respektiert diese Beschränkungen.

Prüfung: `docker compose config`, `docker compose ps`, lokaler `/api/tags`-Aufruf und eine echte Completion. Ohne diese Checks ist der Dienst nicht als betriebsbereit anzusehen.
