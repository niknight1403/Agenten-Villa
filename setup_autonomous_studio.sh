#!/bin/bash
set -e

echo "=== [1/4] System-Updates & Toolpacks installieren ==="
pkg update -y && pkg upgrade -y
pkg install -y python git curl jq ripgrep clang make nodejs libffi openssl

echo "=== [2/4] Python-Umgebung & SDKs aufsetzen ==="
pip install --upgrade pip
pip install requests openai pydantic colorama

echo "=== [3/4] Autonome Agenten-Engine generieren ==="
cat << 'PYEOF' > auto_agent.py
import os
import sys
import json
import subprocess
import requests
from colorama import Fore, Style, init

init(autoreset=True)

# API Konfiguration (OpenAI / Ollama / Anthropic API Kompatibel)
API_KEY = os.getenv("OPENAI_API_KEY", "ollama")
API_BASE = os.getenv("OPENAI_API_BASE", "http://localhost:11434/v1")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o")

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# ---------------------------------------------------------
# Tool Pack Definitionen
# ---------------------------------------------------------
def tool_execute_bash(command):
    """Führt Shell-Befehle direkt im Termux-Subsystem aus."""
    try:
        res = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=120)
        output = f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}\nEXIT_CODE: {res.returncode}"
        return output
    except Exception as e:
        return f"EXECUTION_ERROR: {str(e)}"

def tool_read_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"READ_ERROR: {str(e)}"

def tool_write_file(filepath, content):
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return f"SUCCESS: File {filepath} written."
    except Exception as e:
        return f"WRITE_ERROR: {str(e)}"

def tool_list_files(directory="."):
    try:
        files = []
        for root, _, filenames in os.walk(directory):
            for fn in filenames:
                if not any(x in root for x in ['.git', 'node_modules', 'venv', '__pycache__']):
                    files.append(os.path.relpath(os.path.join(root, fn), directory))
        return "\n".join(files) if files else "Directory empty."
    except Exception as e:
        return f"LIST_ERROR: {str(e)}"

TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "execute_bash",
            "description": "Executes shell commands in Termux.",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string"}},
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Reads full content of a specified file.",
            "parameters": {
                "type": "object",
                "properties": {"filepath": {"type": "string"}},
                "required": ["filepath"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Creates or overwrites a file with given content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filepath": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["filepath", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "Lists all relevant project files recursively.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "mark_task_complete",
            "description": "Signals that development is fully functional, tested, and verified GREEN.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"}
                },
                "required": ["summary"]
            }
        }
    }
]

# ---------------------------------------------------------
# Autonomer Execution Loop Engine
# ---------------------------------------------------------
def run_autonomous_loop(task_prompt, max_turns=30):
    messages = [
        {
            "role": "system",
            "content": (
                "Du bist eine vollautonome KI-Entwickler-Engine auf Termux (Android). "
                "Deine Aufgabe ist es, Anforderungsspezifikationen eigenständig zu analysieren, "
                "Code zu schreiben, Tests auszuführen und Fehler selbstständig im Loop zu beheben. "
                "Liefere KEINE Zwischenfragen. Melde erst 'mark_task_complete', wenn der Code grün ist."
            )
        },
        {"role": "user", "content": task_prompt}
    ]

    print(f"{Fore.CYAN}[START] Autonomer Entwicklungsprozess initiiert...")
    
    for turn in range(1, max_turns + 1):
        print(f"\n{Fore.YELLOW}--- Loop Iteration {turn}/{max_turns} ---")
        
        payload = {
            "model": MODEL_NAME,
            "messages": messages,
            "tools": TOOLS_SPEC,
            "tool_choice": "auto"
        }
        
        try:
            resp = requests.post(f"{API_BASE}/chat/completions", headers=headers, json=payload, timeout=90)
            resp_data = resp.json()
            
            if "choices" not in resp_data or not resp_data["choices"]:
                print(f"{Fore.RED}[ERR] Ungültige API-Antwort: {resp_data}")
                break

            choice = resp_data["choices"][0]["message"]
            messages.append(choice)

            if choice.get("content"):
                print(f"{Fore.WHITE}{choice['content']}")

            tool_calls = choice.get("tool_calls", [])
            if not tool_calls:
                continue

            for tc in tool_calls:
                func_name = tc["function"]["name"]
                args = json.loads(tc["function"]["arguments"])
                call_id = tc["id"]

                print(f"{Fore.BLUE}[TOOL] {func_name}({args})")

                if func_name == "mark_task_complete":
                    print(f"\n{Fore.GREEN}===========================================")
                    print(f"{Fore.GREEN}[STATUS: GRÜN] Autonome Entwicklung ERFOLGREICH!")
                    print(f"{Fore.GREEN}Zusammenfassung:\n{args.get('summary')}")
                    print(f"{Fore.GREEN}===========================================")
                    return True

                # Tool-Ausführung
                if func_name == "execute_bash":
                    res = tool_execute_bash(args.get("command", ""))
                elif func_name == "read_file":
                    res = tool_read_file(args.get("filepath", ""))
                elif func_name == "write_file":
                    res = tool_write_file(args.get("filepath", ""), args.get("content", ""))
                elif func_name == "list_files":
                    res = tool_list_files()
                else:
                    res = "Unknown tool."

                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": res
                })

        except Exception as e:
            print(f"{Fore.RED}[LOOP EXCEPTION] {str(e)}")

    print(f"\n{Fore.RED}[STATUS: ROT] Abbruch nach {max_turns} Iterationen ohne grüne Validierung.")
    return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python auto_agent.py \"<AUFGABENSTELLUNG>\"")
        sys.exit(1)
    
    prompt = sys.argv[1]
    run_autonomous_loop(prompt)
PYEOF

echo "=== [4/4] Erstelle Umgebungskonfiguration & Starter ==="
cat << 'ENVEOF' > .env
OPENAI_API_KEY=dein_api_schluessel_hier
OPENAI_API_BASE=https://api.openai.com/v1
MODEL_NAME=gpt-4o
ENVEOF

cat << 'RUNEOF' > run_auto.sh
#!/bin/bash
export $(grep -v '^#' .env | xargs)
python auto_agent.py "$1"
RUNEOF

chmod +x run_auto.sh
chmod +x setup_autonomous_studio.sh

echo "=================================================="
echo " [GRÜN] Installation & Einrichtung abgeschlossen!"
echo "=================================================="
