import { useEffect, useState, useCallback } from "react";

type ControllerStatus = "RUNNING" | "STOPPED" | "STARTING" | "STOPPING";

interface ControllerState {
  status: ControllerStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  activeWorkers: number;
  savedAt: string | null;
}

export function ControllerWidget() {
  const [state, setState] = useState<ControllerState | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/controller/stream");
    es.onmessage = (e) => {
      try { setState(JSON.parse(e.data)); } catch {}
    };
    return () => es.close();
  }, []);

  const handleToggle = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);
    try {
      await fetch("/api/trpc/controller.toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      setIsPending(false);
    }
  }, [isPending]);

  if (!state) return <div className="text-muted-foreground text-sm">Verbinde…</div>;

  const isRunning = state.status === "RUNNING";
  const isTransitioning = state.status === "STARTING" || state.status === "STOPPING";

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4 w-full max-w-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Villa-Controller</span>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${isRunning ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
          <span className={`text-xs font-mono font-bold ${isRunning ? "text-green-400" : "text-red-400"}`}>{state.status}</span>
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={isPending || isTransitioning}
        className={`w-full py-3 rounded-lg font-bold text-sm transition-all ${isRunning ? "bg-red-500/10 border border-red-500/40 text-red-400 hover:bg-red-500/20" : "bg-green-500/10 border border-green-500/40 text-green-400 hover:bg-green-500/20"} disabled:opacity-50`}
      >
        {isTransitioning ? state.status : isRunning ? "⏹ System stoppen" : "▶ System starten"}
      </button>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div><p className="text-[10px] uppercase">Worker</p><p className="font-mono text-foreground">{state.activeWorkers}</p></div>
        <div><p className="text-[10px] uppercase">{isRunning ? "Gestartet" : "Gestoppt"}</p>
          <p className="font-mono text-foreground">
            {(isRunning ? state.startedAt : state.stoppedAt) ? new Date((isRunning ? state.startedAt : state.stoppedAt)!).toLocaleTimeString("de-DE") : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
