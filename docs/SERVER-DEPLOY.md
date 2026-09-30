# Agenten Villa auf eigenem Server mit eigener Domain

Dieser Stack laesst die Villa aus einem Docker-Container laufen, hinter dem Caddy
als Reverse-Proxy steht. Caddy besorgt automatisch ein HTTPS-Zertifikat von
Let's Encrypt fuer die eigene Domain. Neon (Datenbank), der Code auf GitHub und
alle KI-Routen bleiben unveraendert: nur das Hosting wechselt von Render auf den
eigenen Server.

Voraussetzungen auf dem Server:

- Ubuntu/Debian-Server mit root-Zugriff (SSH)
- Docker + Docker Compose (unten Schritt fuer Schritt)
- Die Domain zeigt per A-Record auf die Server-IP

## Schritt 1: Server vorbereiten (einmalig)

Per SSH auf dem Server:

```bash
# Docker installieren (falls nicht vorhanden)
curl -fsSL https://get.docker.com | sh

# Firewall: Web-Freigaben setzen
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
```

## Schritt 2: DNS-Record setzen

Im DNS-Panel des Registrars (wo cybersarah-ki.com liegt):

| Typ | Name | Wert        | TTL |
|-----|------|-------------|-----|
| A   | @    | <Server-IP> | 600 |
| A   | www  | <Server-IP> | 600 |

Pruefen bis die Domain ankommt (kann ein paar Minuten dauern):

```bash
ping -c 2 cybersarah-ki.com
```

## Schritt 3: App ausrollen

```bash
git clone https://github.com/niknight1403/Agenten-Villa.git
cd Agenten-Villa/deploy

# Umgebung einrichten
cp .env.example .env
nano .env   # Werte ausfuellen (siehe Hinweise unten)

# Starten (erste Lauf baut das Image, dauert ein paar Minuten)
docker compose up -d --build
```

Live-Check:

```bash
curl https://cybersarah-ki.com/api/health
```

## Schritt 4: Google OAuth fuer die neue Domain

In der Google Cloud Console beim bestehenden OAuth-Client die Redirect-URI
ergaenzen:

```
https://cybersarah-ki.com/api/auth/google/callback
```

`PUBLIC_BASE_URL=https://cybersarah-ki.com` (in `.env`) stellt sicher, dass der
Redirect exakt so erzeugt wird.

## Hinweise zu den .env-Werten

- `DATABASE_URL`: unveraendert von Render uebernehmen. Die Datenbank bleibt bei
  Neon, alle Daten bleiben erhalten.
- `JWT_SECRET`: neu erzeugen mit `openssl rand -hex 32` (alle bestehenden
  Logins werden dadurch ungültig, einmal neu anmelden genuegt).
- `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_*`: Werte aus der
  Render-Umgebung der laufenden Instanz kopieren.
- Migrationen sind nicht noetig: die Neon-Datenbank ist bereits migriert.

## Betrieb

```bash
# Logs ansehen
docker compose logs -f villa

# Nach einem git pull neu ausrollen
git pull && docker compose up -d --build

# Stoppen
docker compose down
```

## Von Render umziehen (Übergang)

Beide Instanzen koennen kurz parallel laufen (gleiche Neon-DB). Nach dem
Live-Check der Server-Instanz den Render-Service als Fallback behalten oder
loeschen; die alte Render-URL kann danach abgeschaltet werden.
