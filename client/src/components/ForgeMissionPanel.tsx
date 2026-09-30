import { useState } from "react";
import {
  MEMORY_KINDS,
  type ForgeMemory,
  type ForgeOptions,
} from "@shared/forge";
import { trpc } from "@/lib/trpc";

export function ForgeMissionPanel({
  value,
  onChange,
  disabled,
}: {
  value: ForgeOptions;
  onChange: (options: ForgeOptions) => void;
  disabled: boolean;
}) {
  const [kind, setKind] = useState<ForgeMemory["kind"]>("CONSTRAINT");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState(5);
  // This endpoint plans offline: no model calls, writes or external actions.
  const plan = trpc.agent.forgePlan.useQuery(value, {
    retry: false,
    staleTime: 60_000,
  });
  const inputClass =
    "rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200";
  return (
    <fieldset
      disabled={disabled}
      className="mt-4 rounded-2xl border border-violet-500/20 p-4 disabled:opacity-60"
    >
      <legend className="px-2 text-sm font-semibold text-violet-200">
        VillaForge Missionsplanung
      </legend>
      <label className="block text-sm">
        Strategie
        <select
          aria-label="VillaForge Strategie"
          className={`${inputClass} ml-2`}
          value={value.strategy}
          onChange={e =>
            onChange({
              ...value,
              strategy: e.target.value as ForgeOptions["strategy"],
            })
          }
        >
          <option value="OPTIMIZE">OPTIMIZE: vorhandene App verbessern</option>
          <option value="REBUILD">REBUILD: begründeten Neubau planen</option>
        </select>
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.productReview}
          onChange={e =>
            onChange({ ...value, productReview: e.target.checked })
          }
        />
        Business/Growth als Produktreview einbeziehen
      </label>
      <p className="mt-3 text-xs text-slate-400">
        Offline-Plan ohne Modellkosten. Logische Rollen, keine zusätzlich
        gestarteten Worker. REBUILD erlaubt keine Datenlöschung.
      </p>
      {plan.isError ? (
        <p role="alert" className="mt-2 text-sm text-amber-300">
          Missionsplan nicht verfügbar: {plan.error.message}
        </p>
      ) : (
        <ol className="mt-3 space-y-1 text-xs text-slate-300">
          {plan.data?.tasks.map(task => (
            <li key={task.id}>
              <strong>{task.role}</strong>: {task.title}
            </li>
          ))}
        </ol>
      )}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer">
          Missionsgedächtnis ({value.memory.length}/12)
        </summary>
        <p className="my-2 text-xs text-slate-400">
          Wird mit diesem Auftrag gespeichert und bei ausdrücklich bestätigtem
          Neustart wiederverwendet. Kein globales Gedächtnis. Keine Secrets
          eintragen.
        </p>
        <div className="grid gap-2">
          {value.memory.map((item, index) => (
            <div key={index} className="rounded-lg bg-slate-800 p-2 text-xs">
              <strong>
                {item.kind}: {item.title}
              </strong>
              <p className="break-words">{item.content}</p>
              <button
                type="button"
                className="mt-1 underline"
                onClick={() =>
                  onChange({
                    ...value,
                    memory: value.memory.filter((_, i) => i !== index),
                  })
                }
              >
                Entfernen
              </button>
            </div>
          ))}
          <select
            className={inputClass}
            aria-label="Gedächtnisart"
            value={kind}
            onChange={e => setKind(e.target.value as ForgeMemory["kind"])}
          >
            {MEMORY_KINDS.map(k => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input
            className={inputClass}
            aria-label="Gedächtnistitel"
            placeholder="Titel"
            maxLength={100}
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className={inputClass}
            aria-label="Gedächtnisinhalt"
            placeholder="Belegter Kontext oder Einschränkung"
            maxLength={600}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
          <label className="text-xs">
            Wichtigkeit: {importance}
            <input
              aria-label="Wichtigkeit"
              className="ml-2"
              type="range"
              min={1}
              max={10}
              value={importance}
              onChange={e => setImportance(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="rounded-lg border border-violet-500/40 p-2 disabled:opacity-40"
            disabled={
              value.memory.length >= 12 || !title.trim() || !content.trim()
            }
            onClick={() => {
              onChange({
                ...value,
                memory: [
                  ...value.memory,
                  {
                    kind,
                    title: title.trim(),
                    content: content.trim(),
                    importance,
                  },
                ],
              });
              setTitle("");
              setContent("");
            }}
          >
            Kontext hinzufügen
          </button>
        </div>
      </details>
    </fieldset>
  );
}
