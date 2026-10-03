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

## Übergang: Server mit bestehendem OpenHands (Hetzner, cybersarah-ki.com)

Auf dem Hetzner-Server laeuft bereits ein OpenHands-Stack mit eigenem Caddy auf
Port 443. Die Villa uebernimmt die Domain, OpenHands wird gestoppt und bleibt als
Container erhalten.

### 1. Bestehende Stacks ansehen und OpenHands stoppen

```bash
# Welche Compose-Stacks laufen wo?
docker compose ls

# OpenHands-Stack stoppen (im Verzeichnis des Stacks, Namen aus obiger Liste):
cd <openhands-stack-verzeichnis>
docker compose stop          # Container bleiben erhalten

# Falls der Caddy dahinter ein eigener systemd-Dienst ist:
systemctl stop caddy 2>/dev/null || systemctl stop docker-openhands-caddy 2>/dev/null
```

### 2. Villa ausrollen (siehe Schritt 3 oben)

```bash
cd ~
git clone -b agent/server-deploy-cybersarah https://github.com/niknight1403/Agenten-Villa.git
cd Agenten-Villa/deploy
cp .env.example .env && nano .env
docker compose up -d --build
```

Der Caddy dieses Stacks belegt jetzt 80/443 und besorgt das Zertifikat fuer
cybersarah-ki.com.

### 3. OpenHands spaeter wieder hochfahren (optional, eigene Subdomain)

```bash
cd <openhands-stack-verzeichnis>
docker compose start
```

Damit die Domain-Kollision vermieden wird, vorher in dessen Caddyfile eine eigene
Subdomain (z.B. hands.cybersarah-ki.com) eintragen und den DNS-A-Record dafuer
im Hetzner-DNS-Panel setzen.
