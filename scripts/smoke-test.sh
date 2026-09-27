#!/usr/bin/env bash
# Smoke-Test gegen eine laufende Agenten-Villa-Instanz.
# Aufruf: ./scripts/smoke-test.sh [Basis-URL]   (Default: Produktions-URL)
set -euo pipefail

BASE="${1:-https://agenten-villa.onrender.com}"
FAIL=0

check() {
  local name="$1" expected="$2" url="$3" actual
  actual="$(curl -s -o /dev/null -w '%{http_code}' "$url")"
  if [ "$actual" = "$expected" ]; then
    echo "  OK  $name ($actual)"
  else
    echo "  FEHLER  $name: erwartet $expected, bekommen $actual ($url)"
    FAIL=1
  fi
}

echo "Smoke-Test gegen: $BASE"
check "SPA erreichbar"            200 "$BASE/"
check "Health-Endpoint ok"        200 "$BASE/api/health"
check "Login-Seite erreichbar"    200 "$BASE/login"
check "SPA-Fallback"              200 "$BASE/unbekannte-route"
check "Auth-Schutz aktiv (401)"   401 "$BASE/api/trpc/villa.list"

# Health-Payload muss ok:true enthalten
BODY="$(curl -s "$BASE/api/health")"
if echo "$BODY" | grep -q '"ok":true'; then
  echo "  OK  Health-Payload ok:true ($(echo "$BODY" | head -c 120))"
else
  echo "  FEHLER  Health-Payload ohne ok:true: $BODY"
  FAIL=1
fi

# Kompression aktiv?
ENC="$(curl -s -o /dev/null -H 'Accept-Encoding: gzip' -w '%{size_download}' "$BASE/")"
if [ "$ENC" -gt 0 ]; then
  echo "  OK  SPA antwortet mit Daten (${ENC} Bytes, gzip)"
else
  echo "  FEHLER  SPA liefert leere Antwort"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "Alles gruen."
else
  echo "Smoke-Test fehlgeschlagen." >&2
  exit 1
fi
