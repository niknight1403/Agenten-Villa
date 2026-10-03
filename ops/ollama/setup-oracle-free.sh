#!/usr/bin/env bash
# Agenten-Villa — Ollama-Bootstrap fuer Linux-Server (Ubuntu/Debian, x86_64 oder ARM)
# Sprint 082/083. Idempotent: kann gefahrlos mehrfach ausgefuehrt werden.
# Getestet gedacht fuer: Oracle Cloud Always Free (ARM) und Hetzner-VPS (CyberSarah-pro).
# RAM-Realismus: Modelle klein zuerst ziehen; 27b/30b nur bei >= 24 GB RAM.
#
# Pflicht-Umgebungsvariablen (vor dem Aufruf setzen):
#   OLLAMA_DOMAIN            z. B. ollama.cybersarah-ki.com (DNS-Record vorher anlegen!)
#   OLLAMA_TOKEN             langes Zufalls-Token, z. B.: openssl rand -hex 32
#   OLLAMA_CERTBOT_EMAIL     E-Mail fuer Let's-Encrypt-Hinweise
#
# Optional:
#   OLLAMA_MODELS_INSTALL    Leerzeichen-getrennte Modellliste
#                            (Default: gemma4:12b devstral:24b qwen3.6:27b — RAM-realistisch)
#   OLLAMA_INCLUDE_30B=true  zieht zusaetzlich qwen3-coder:30b (~19 GB Q4;
#                            auf 24 GB RAM grenzwertig — nur bei Bedarf)
#
# Was das Skript tut:
#   1. Ollama (arm64) installieren, als systemd-Dienst auf 127.0.0.1:11434
#   2. Modelle ziehen (Reihenfolge: klein zuerst, damit frueh nutzbar)
#   3. nginx als TLS-Reverse-Proxy mit Bearer-Token-Schutz (Let's Encrypt)
# Danach erreichbar: https://OLLAMA_DOMAIN/v1/chat/completions (OpenAI-kompatibel)

set -euo pipefail

DOMAIN="${OLLAMA_DOMAIN:?Fehler: OLLAMA_DOMAIN ist nicht gesetzt (z. B. export OLLAMA_DOMAIN=ollama.cybersarah-ki.com)}"
TOKEN="${OLLAMA_TOKEN:?Fehler: OLLAMA_TOKEN ist nicht gesetzt (z. B. export OLLAMA_TOKEN=\$(openssl rand -hex 32))}"
CERTBOT_EMAIL="${OLLAMA_CERTBOT_EMAIL:?Fehler: OLLAMA_CERTBOT_EMAIL ist nicht gesetzt}"
MODELS_INSTALL="${OLLAMA_MODELS_INSTALL-gemma4:12b devstral:24b qwen3.6:27b}"

echo "== [1/4] Ollama installieren (falls noch nicht vorhanden) =="
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "Ollama bereits installiert: $(ollama --version 2>/dev/null || true)"
fi

echo "== [2/4] systemd-Dienst: nur localhost, ressourcenschonend =="
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/villa.conf >/dev/null <<'UNIT'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_KEEP_ALIVE=10m"
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
systemctl is-active --quiet ollama || { echo "Fehler: ollama-Dienst laeuft nicht"; exit 1; }
curl -fsS http://127.0.0.1:11434/ >/dev/null && echo "Ollama erreichbar auf 127.0.0.1:11434"

echo "== [3/4] Modelle ziehen (klein zuerst; ~39 GB insgesamt bei Default) =="
if [ "${OLLAMA_INCLUDE_30B:-false}" = "true" ]; then
  MODELS_INSTALL="$MODELS_INSTALL qwen3-coder:30b"
fi
for model in $MODELS_INSTALL; do
  echo "   ziehe $model …"
  ollama pull "$model"
done
ollama list

echo "== [4/4] nginx-TLS-Proxy mit Bearer-Token-Schutz =="
sudo apt-get update -qq
sudo apt-get install -y -qq nginx certbot python3-certbot-nginx openssl >/dev/null

# Konfiguration aus Template schreiben (Token landet NUR auf dem Server, nie im Repo)
sudo sed -e "s|__DOMAIN__|${DOMAIN}|g" \
         -e "s|__TOKEN__|${TOKEN}|g" \
         "$(dirname "$0")/nginx-ollama.conf" \
  | sudo tee /etc/nginx/sites-available/ollama >/dev/null
sudo ln -sf /etc/nginx/sites-available/ollama /etc/nginx/sites-enabled/ollama
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t

# Oracle-Images blockieren 443 in iptables trotz Security-List — einmalig oeffnen
if sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null; then
  echo "iptables: 443 bereits offen"
else
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null 2>&1 && sudo netfilter-persistent save || true
fi

# Zertifikat (vorher DNS-Record auf die Public-IP der VM zeigen lassen!)
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
sudo systemctl reload nginx

echo ""
echo "== Fertig. Verifikation: =="
echo "   curl -H \"Authorization: Bearer \$OLLAMA_TOKEN\" https://${DOMAIN}/v1/models"
echo ""
echo "== Fuer Render (Agenten-Villa) dann setzen: =="
echo "   OLLAMA_BASE_URL=https://${DOMAIN}/v1"
echo "   OLLAMA_API_KEY=<dein Token>"
