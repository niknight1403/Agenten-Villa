#!/usr/bin/env bash
# Google-Sign-In-Probe: Installiert die RELEASE-APK (signiert mit dem
# SHA-1, der in der Google Cloud Console registriert ist), tippt den
# "Mit Google anmelden"-Button an und klassifiziert das Ergebnis:
#   PICKER_OPENED     -> Google akzeptiert App-Paket + SHA-1 (Konfiguration OK)
#   DEVELOPER_ERROR_10 -> Android-Client fehlt/nicht propagiert (ApiException 10)
#   NATIVE_FAILED     -> sonstiger Anmeldefehler (Details im Logcat)
set -euo pipefail

APK=android/app/build/outputs/apk/release/app-release.apk
adb install -r "$APK"
adb logcat -c || true
adb shell am start -n de.niknight1403.agentenvilla/.MainActivity
trap 'adb exec-out screencap -p > signin-probe.png || true' EXIT

# 1) Warten, bis die Anmeldeseite sichtbar ist (WebView-Text nur via OCR).
ready=0
for attempt in {1..12}; do
  sleep 8
  adb exec-out screencap -p > signin-probe.png
  if command -v tesseract >/dev/null; then
    tesseract signin-probe.png stdout -l deu+eng 2>/dev/null > probe-ocr.txt || true
    if grep -Eqi 'Mit Google anmelden|Willkommen zur' probe-ocr.txt; then
      ready=1
      echo "Anmeldeseite sichtbar (Versuch ${attempt}/12)."
      break
    fi
  fi
  if grep -qi 'Quickstep.*responding' probe-ocr.txt 2>/dev/null; then
    adb shell input tap 350 1330
  fi
done
if [ "$ready" -ne 1 ]; then
  echo "FEHLER: Anmeldeseite nicht erreicht." >&2
  adb logcat -d -t 500 -v brief >&2 | tail -80 || true
  exit 2
fi

# 2) Buttonposition per OCR-TSV ermitteln und antippen (WebView nicht in UIAutomator).
tesseract signin-probe.png stdout -l deu+eng tsv 2>/dev/null > probe.tsv || true
python3 - <<'PY'
import csv
lines = {}
with open("probe.tsv") as f:
    for row in csv.DictReader(f, delimiter="\t"):
        t = (row.get("text") or "").strip()
        if not t:
            continue
        key = (row["block_num"], row["par_num"], row["line_num"])
        d = lines.setdefault(key, {"l": 10**9, "t": 10**9, "r": 0, "b": 0, "w": []})
        d["l"] = min(d["l"], int(row["left"])); d["t"] = min(d["t"], int(row["top"]))
        d["r"] = max(d["r"], int(row["left"]) + int(row["width"]))
        d["b"] = max(d["b"], int(row["top"]) + int(row["height"]))
        d["w"].append(t.lower())
line = next((d for d in lines.values() if "google" in " ".join(d["w"]) and "anmelden" in " ".join(d["w"])), None)
if line is None:
    line = next((d for d in lines.values() if "google" in " ".join(d["w"])), None)
tap = f"{(line['l'] + line['r']) // 2} {(line['t'] + line['b']) // 2}" if line else ""
open("/tmp/tap.txt", "w").write(tap)
print(f"Tap-Punkt: {tap or 'nicht gefunden'}", flush=True)
PY
TAP=$(cat /tmp/tap.txt 2>/dev/null || echo "")
if [ -z "$TAP" ]; then
  echo "FEHLER: Google-Button per OCR nicht gefunden." >&2
  exit 2
fi
adb shell input tap "$TAP"
echo "Google-Button angetippt: $TAP"

# 3) Ergebnis klassifizieren (Kontoauswahl ist native GMS-UI, Fehlermeldung im WebView).
verdict="UNRESOLVED"
for attempt in {1..18}; do
  sleep 5
  adb exec-out screencap -p > signin-probe.png
  adb shell uiautomator dump /data/local/tmp/probe-ui.xml >/dev/null 2>&1 || true
  adb exec-out cat /data/local/tmp/probe-ui.xml > probe-ui.xml 2>/dev/null || true
  tesseract signin-probe.png stdout -l deu+eng 2>/dev/null > probe-ocr.txt || true
  UI="$(cat probe-ui.xml probe-ocr.txt 2>/dev/null || true)"
  if echo "$UI" | grep -Eq 'com\.google\.android\.gms|Konto hinzuf|Add account|Choose an account|Konto ausw'; then
    verdict="PICKER_OPENED"; break
  fi
  if echo "$UI" | grep -q 'noch nicht freigeschaltet'; then
    verdict="DEVELOPER_ERROR_10"; break
  fi
  if echo "$UI" | grep -Eq 'Anmeldung bei Google ist fehlgeschlagen|Anmeldung ist fehlgeschlagen|Anmeldung fehlgeschlagen|Details:'; then
    verdict="NATIVE_FAILED"; break
  fi
  if echo "$UI" | grep -q 'Anmeldung läuft'; then
    echo "… Anmeldung läuft noch (${attempt}/18)."
  fi
done

echo "=== ERGEBNIS: $verdict ==="
adb logcat -d -t 3000 -v brief 2>/dev/null > probe-logcat-full.txt || true
grep -iE 'GoogleAuth|GoogleSignIn|ApiException|DEVELOPER_ERROR|GmsSign|gms' probe-logcat-full.txt | tail -50 > probe-logcat.txt || true
cat probe-logcat.txt || true
adb exec-out screencap -p > signin-probe.png || true

case "$verdict" in
  PICKER_OPENED)
    echo "OK: Google akzeptiert die App-Konfiguration (SHA-1/Paket) — Kontoauswahl wurde geöffnet."
    exit 0 ;;
  DEVELOPER_ERROR_10)
    echo "FEHLER (ApiException 10): Android-Client mit Paketname/SHA-1 ist bei Google noch nicht registriert oder noch nicht propagiert."
    exit 1 ;;
  NATIVE_FAILED)
    echo "FEHLER: Native Anmeldung fehlgeschlagen (kein Code 10) — Details im Logcat/Artifacts."
    exit 1 ;;
  *)
    echo "FEHLER: Kein klares Ergebnis innerhalb des Zeitfensters — Artifacts prüfen."
    exit 1 ;;
esac
