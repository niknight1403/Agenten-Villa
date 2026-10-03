import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import {
  usageDisplay,
  type TurnUsageSummaryLike,
  type UsageDisplay,
} from "@/lib/usage-format";

/**
 * Sprint 077 — Token-/Budget-Widget: live ueber den Watchdog-SSE-Stream
 * (/api/controller/stream, tick-Ereignisse). Zeigt die begrenzte
 * Live-Summe der Token-Nutzung je Anbieter sowie die geschaetzten Kosten
 * (Free-Tier = 0,00 EUR — ehrlich, nicht fiktiv).
 */
export function TokenBudgetWidget() {
  const [usage, setUsage] = useState<UsageDisplay | null>(null);
  const [live, setLive] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/controller/stream");
    source.onopen = () => setLive(true);
    source.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          report?: { at?: string; usage?: TurnUsageSummaryLike | null };
        };
        if (data.type === "tick" && data.report?.usage) {
          setUsage(usageDisplay(data.report.usage));
          setLastTickAt(data.report.at ?? null);
        }
      } catch {
        /* unvollstaendige Nachrichten ignorieren */
      }
    };
    source.onerror = () => setLive(false);
    return () => source.close();
  }, []);

  return (
    <section className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Coins className={live ? "text-amber-400" : "text-slate-500"} size={22} />
          <div>
            <h2 className="text-lg font-semibold">Token-Budget</h2>
            <p className="text-xs text-slate-500">
              Live-Verbrauch je Anbieter — begrenzte Prozesshistorie, kein Nutzinhalt
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={`h-2.5 w-2.5 rounded-full ${live ? "bg-amber-400 shadow-[0_0_12px_#fbbf24]" : "bg-slate-600"}`}
          />
          <span className="text-slate-400">
            {live ? (lastTickAt ? `Letzter Tick ${new Date(lastTickAt).toLocaleTimeString("de-DE")}` : "warte auf ersten Tick") : "Verbinde …"}
          </span>
        </div>
      </div>

      {usage === null ? (
        <p className="mt-4 text-sm text-slate-500">
          Noch keine Nutzungsdaten — der erste Watchdog-Tick meldet sich innerhalb einer Minute.
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Turns" value={usage.turns} />
            <StatTile label="Prompt-Tokens" value={usage.prompt} />
            <StatTile label="Antwort-Tokens" value={usage.completion} />
            <StatTile label="Tokens gesamt" value={usage.total} />
            <StatTile label="Geschätzte Kosten" value={usage.cost} />
          </div>
          {usage.perProvider.length > 0 ? (
            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-950/60 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Anbieter</th>
                    <th className="px-4 py-2.5 text-right">Turns</th>
                    <th className="px-4 py-2.5 text-right">Tokens</th>
                    <th className="px-4 py-2.5 text-right">Kosten</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.perProvider.map(row => (
                    <tr key={row.provider} className="border-t border-slate-800">
                      <td className="px-4 py-2.5 font-medium">{row.provider}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.turns}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.tokens}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-slate-600">
            Die aktive Anbieterkette läuft im Free-Tier — Kosten bleiben ehrlich bei 0,00&nbsp;EUR, solange kein bezahltes Modell konfiguriert ist.
          </p>
        </>
      )}
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-slate-100">{value}</p>
    </div>
  );
}
