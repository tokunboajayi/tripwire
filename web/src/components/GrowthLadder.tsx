import { useCallback, useEffect, useState } from "react";
import { api, usd } from "../lib/api";
import { Icon } from "./Icons";

const years = (m: number | null) => (m == null ? "over 100 years" : m < 12 ? `${m} months` : `${(m / 12).toFixed(1)} years`);

/** Owner-only Growth Ladder: capital is earned on the record, raised at most 2× per 30 days; projection from real numbers. */
export function GrowthLadder() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [monthly, setMonthly] = useState("");
  const [target, setTarget] = useState("");
  const load = useCallback(() => api("/v1/ladder").then((v) => { setS(v); setMonthly((m) => m || String(v.monthly_contribution ?? 0)); setTarget((t) => t || String(v.target ?? 1000000)); },
    (e) => { if (e.status === 403 || e.status === 404) setS(false); }), []);
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);
  if (!s || s.mode === "off") return null;

  const raise = async () => {
    setMsg("");
    try { setS(await api("/v1/ladder/raise", "POST", { to: s.next_raise_max })); setMsg(`Raised to ${usd(s.next_raise_max, 0)}.`); }
    catch (e: any) { setMsg(e.message); }
  };
  const save = async () => setS(await api("/v1/ladder/settings", "POST", { monthly_contribution: Number(monthly) || 0, target: Number(target) || 1000000 }));
  const passed = s.gates.filter((g: any) => g.ok).length;

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Icon n="chart" size={18} className="text-wire" />Growth Ladder
          <span className="rounded bg-wire/15 px-2 py-0.5 font-mono text-xs text-wire">{s.enforced ? "LIVE · ENFORCED" : "PAPER · MEASURING"}</span></h2>
        <button className="btn btn-primary" disabled={!s.enforced || !s.eligible || s.next_raise_max <= s.allowed} onClick={raise}>
          Raise to {usd(s.next_raise_max, 0)}
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        {s.enforced ? <>Live trading is capped at <b className="text-white">{usd(s.allowed, 0)}</b> (of {usd(s.capital_ceiling, 0)} configured). </> : <>Paper isn't capped; this measures the record you'll need to go live. </>}
        Capital is raised at most 2× per 30 days, only when every check passes. A 10% drop from the peak halts buys.
      </p>
      {msg && <p role="status" className="mt-2 text-sm text-amber-300">{msg}</p>}

      <h3 className="mt-4 text-sm font-semibold text-slate-300">Checks for the next raise ({passed}/{s.gates.length})</h3>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {s.gates.map((g: any) => (
          <li key={g.name} className="flex items-center justify-between gap-2 rounded border border-ink-800 px-3 py-1.5">
            <span className="flex items-center gap-2"><Icon n={g.ok ? "ok" : "wait"} size={14} className={g.ok ? "text-up" : "text-slate-500"} />{g.name}</span>
            <span className="font-mono text-xs text-slate-400">{g.value} <span className="text-slate-600">/ {g.need}</span></span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-slate-300">Time to your target, from real numbers</h3>
      <div className="mt-2 flex flex-wrap items-end gap-3 text-sm">
        <label className="text-slate-400">Add each month ($)<input className="ml-2 w-28 rounded border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-white" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
        <label className="text-slate-400">Target ($)<input className="ml-2 w-32 rounded border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-white" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <button className="btn px-3 py-1.5 text-xs" onClick={save}>Update</button>
      </div>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-xs text-slate-500"><tr><th className="py-1">Pace</th><th>Return/yr</th><th>With {usd(s.monthly_contribution, 0)}/mo</th><th>Trading alone</th></tr></thead>
        <tbody className="text-slate-300">
          {s.scenarios.map((x: any) => (
            <tr key={x.label} className="border-t border-ink-800">
              <td className="py-1.5">{x.label}</td><td className="font-mono">{(x.annual * 100).toFixed(1)}%</td>
              <td className="font-mono text-white">{years(x.months)}</td><td className="font-mono">{years(x.months_no_contrib)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Starting from {usd(s.projection_start, 0)}. Your measured pace appears after 30 days on a rung. Deposits are excluded from returns. Not a forecast; past results don't guarantee future ones.</p>
    </section>
  );
}
