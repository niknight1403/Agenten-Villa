"""
Agenten-Villa — ZeroGPU-Space (Sprint 083)

OpenAI-kompatibler Chat-Endpunkt auf Hugging Face ZeroGPU.
Die Villa-Route (Sprint 080) erwartet OLLAMA_BASE_URL=<space>/v1
mit /v1/chat/completions und /v1/models — genau das liefert dieser Space.

Auth (bewusst doppelt ehrlich):
  - Der Space ist PRIVATE: Hugging Face prueft den Authorization: Bearer-
    Header (ein gueltiges HF-Token) BEVOR die Anfrage hier ankommt.
    OLLAMA_API_KEY in Render = dieses HF-Token.
  - Optional zusaetzlich APP_API_KEY als zweite Schicht (Default: aus).

ZeroGPU-Realitaet: GPU-Slices statt 24/7-GPU. Free-Quota ist begrenzt;
laeuft sie leer, antwortet der Space mit 429 — die Villa faellt ehrlich
auf die Cloud-Kette zurueck (Cooldown + Fallback, Sprint 079/080).
"""

import os
import time
from typing import Optional

import gradio as gr
import spaces  # ZeroGPU-Runtime (auf Spaces vorinstalliert)
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = os.environ.get("MODEL_ID", "google/gemma-4-12b-it")
MAX_TOKENS_DEFAULT = int(os.environ.get("MAX_TOKENS_DEFAULT", "1024"))
GPU_DURATION = int(os.environ.get("GPU_DURATION", "120"))
APP_API_KEY = os.environ.get("APP_API_KEY", "")  # optional, zweite Schicht

_model = None
_tokenizer = None


@spaces.GPU(duration=GPU_DURATION)
def generate_reply(messages, max_tokens: int, temperature: float) -> str:
    """Laedt das Modell beim ersten GPU-Slice und generiert die Antwort."""
    global _model, _tokenizer
    if _model is None:
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        _model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.bfloat16,
            device_map="auto",
        )
    prompt = _tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = _tokenizer(prompt, return_tensors="pt").to(_model.device)
    with torch.inference_mode():
        out = _model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=max(0.01, temperature),
            do_sample=temperature > 0.01,
        )
    return _tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)


# ---------- FastAPI mit OpenAI-kompatiblen Routen ----------

app = FastAPI(title="Agenten-Villa ZeroGPU")


def _check_key(request: Request) -> None:
    if APP_API_KEY:  # nur aktiv, wenn APP_API_KEY gesetzt ist
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {APP_API_KEY}":
            raise HTTPException(status_code=401, detail="invalid key")


@app.get("/v1/models")
async def list_models(request: Request):
    _check_key(request)
    return {
        "object": "list",
        "data": [{"id": MODEL_ID, "object": "model", "owned_by": "huggingface"}],
    }


@app.get("/api/ready")
async def ready(request: Request):
    _check_key(request)
    return {"status": "ready", "model": MODEL_ID, "hardware": "zerogpu"}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    _check_key(request)
    body = await request.json()
    messages = [
        {"role": m.get("role", "user"), "content": m.get("content", "")}
        for m in body.get("messages", [])
        if m.get("content")
    ]
    if not messages:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "messages fehlen", "type": "invalid_request"}},
        )
    max_tokens = int(body.get("max_tokens") or MAX_TOKENS_DEFAULT)
    temperature = float(body.get("temperature") or 0.7)
    try:
        started = time.time()
        text = generate_reply(messages, max_tokens, temperature)
    except Exception as exc:  # noqa: BLE001 — ehrlich weiterreichen
        return JSONResponse(
            status_code=500,
            content={"error": {"message": str(exc), "type": "server_error"}},
        )
    return {
        "id": f"zerogpu-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL_ID,
        "choices": [
            {"index": 0, "role": "assistant", "content": text, "finish_reason": "stop"}
        ],
        "usage": {
            "prompt_tokens": -1,  # ehrlich: nicht gezaehlt
            "completion_tokens": -1,
            "total_tokens": -1,
        },
        "villa_meta": {"duration_s": round(time.time() - started, 2)},
    }


# ---------- Minimale Gradio-UI (ZeroGPU verlangt eine Gradio-App) ----------

with gr.Blocks(title="Agenten-Villa ZeroGPU") as demo:
    gr.Markdown(
        f"**Agenten-Villa** — OpenAI-kompatibler ZeroGPU-Endpunkt.\n\n"
        f"Modell: `{MODEL_ID}` · Endpunkte: `/v1/models`, `/v1/chat/completions` "
        f"(privater Space, Auth via HF-Token)."
    )


app = gr.mount_gradio_app(app, demo, path="/")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=7860)
