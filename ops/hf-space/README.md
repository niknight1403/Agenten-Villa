---
title: Villa ZeroGPU
emoji: 🏘️
colorFrom: indigo
colorTo: blue
sdk: gradio
sdk_version: 5.49.0
app_file: app.py
pinned: false
license: mit
short_description: OpenAI-kompatibler ZeroGPU-Endpunkt für die Agenten-Villa
---

# Villa ZeroGPU

OpenAI-kompatibler Chat-Endpunkt (`/v1/chat/completions`, `/v1/models`) auf
ZeroGPU-Slices für die [Agenten-Villa](https://github.com/niknight1403/Agenten-Villa).
Der Space ist **privat**: Aufrufe authentifizieren sich mit dem HF-Token im
`Authorization: Bearer`-Header (dasselbe Token liegt in Render als `OLLAMA_API_KEY`).

Space-Variablen (Settings → Variables and secrets):
- `MODEL_ID` — transformers-Modell (Default: `google/gemma-4-12b-it`)
- `GPU_DURATION` — GPU-Slice-Budget pro Anfrage in s (Default: 120)
- `MAX_TOKENS_DEFAULT` — Default-Antwortlänge (Default: 1024)
- `APP_API_KEY` — optional: zweite Auth-Schicht zusätzlich zum privaten Space
