import { STRATEGIES, type Strategy } from "../lib/api";

/** Adaptive ↔ Trend Core. Open positions keep their own exits when you switch. */
export function StrategyPicker({ value, onChange, disabled }: { value: Strategy; onChange: (s: Strategy) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Strategy" className="grid gap-2 sm:grid-cols-2">
      {(Object.keys(STRATEGIES) as Strategy[]).map((k) => {
        const s = STRATEGIES[k], on = k === value;
        return (
          <button key={k} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(k)}
            className={"rounded-xl border p-3 text-left transition-colors disabled:opacity-50 " + (on ? "border-wire bg-wire/10" : "border-ink-700 hover:border-slate-500")}>
            <div className={"text-sm font-semibold " + (on ? "text-white" : "text-slate-300")}>{s.label}</div>
            <p className="mt-1 text-xs text-slate-400">{s.blurb}</p>
            <p className="mt-1 text-xs text-slate-500">{s.proof}</p>
          </button>
        );
      })}
    </div>
  );
}
