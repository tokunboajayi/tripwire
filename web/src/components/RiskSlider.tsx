import { PROFILES, PROFILE_ORDER, pct, type Profile } from "../lib/api";

/** Conservative ↔ Aggressive slider (3 stops). */
export function RiskSlider({ value, onChange, disabled }: { value: Profile; onChange: (p: Profile) => void; disabled?: boolean }) {
  const i = PROFILE_ORDER.indexOf(value);
  return (
    <div>
      <input type="range" min={0} max={2} step={1} value={i} disabled={disabled} className="risk w-full cursor-pointer disabled:opacity-50"
        aria-label="Risk profile" aria-valuetext={PROFILES[value].label} onChange={(e) => onChange(PROFILE_ORDER[+e.target.value])} />
      <div className="mt-3 grid grid-cols-3 text-sm">
        {PROFILE_ORDER.map((p, k) => (
          <button key={p} type="button" disabled={disabled} onClick={() => onChange(p)}
            className={(k === 0 ? "text-left " : k === 1 ? "text-center " : "text-right ") + (p === value ? "font-bold text-white" : "text-slate-400 hover:text-slate-200")}>
            {PROFILES[p].label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Live preview of the hard limits for a profile. */
export function LimitsTable({ profile, compact }: { profile: Profile; compact?: boolean }) {
  const L = PROFILES[profile];
  const rows: [string, string][] = [
    ["Risk per dip or breakout trade", pct(L.risk)],
    ["Trend volatility target", pct(L.vol)],
    ["Most in any one coin", pct(L.maxpos)],
    ["Most invested in total", pct(L.exposure)],
    ["Auto-pause after a daily loss of", pct(L.daily)],
  ];
  return (
    <dl className={"divide-y divide-ink-700 " + (compact ? "text-sm" : "")}>
      {rows.map(([k, v]) => (
        <div key={k} className={"flex items-center justify-between gap-4 " + (compact ? "py-2" : "py-3")}>
          <dt className="text-slate-400">{k}</dt>
          <dd key={v} className="rise font-semibold text-white num">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
