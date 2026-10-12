import { useCallback, useEffect, useState } from "react";
import { api, signedUsd, time, usd } from "../lib/api";
import { Icon } from "./Icons";

/** Owner-only broker panel (BROKER=paper|live): dollar caps, broker equity, halt / resume / flatten, recent fills. */
export function LiveBroker({ mode }: { mode: string }) {
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => api("/v1/live").then(setS, (e) => { if (e.status === 403 || e.status === 404) setS(false); }), []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);
  if (!s) return null; // not the owner, or the broker is off

  const act = async (a: string) => {
    if (a === "flatten" && !confirm(`Close every ${s.mode === "live" ? "REAL-MONEY " : ""}broker position now and halt buys?`)) return;
    setBusy(a); setError("");
    try { setS(await api(`/v1/live/${a}`, "POST")); } catch (e: any) { setError(e.message); }
    setBusy("");
  };
  const live = s.mode === "live";
  const g = s.guard;
  const Stat = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
    <div className="rounded-lg border border-ink-700 bg-ink-950 p-3"><div className="text-xs text-slate-400">{k}</div><div className="mt-1 font-mono text-white">{v}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>
  );

  return (
    <section className={"card p-6 " + (live ? "border-down/40" : "")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Icon n="wallet" size={18} className={live ? "text-red-300" : "text-wire"} />Broker
          <span className={"rounded px-2 py-0.5 font-mono text-xs " + (live ? "bg-down/20 text-red-300" : "bg-wire/15 text-wire")}>{live ? "LIVE · REAL MONEY" : "PAPER REHEARSAL"}</span>
        </h2>
        <div className="flex gap-2">
          {s.halted ? <button className="btn" disabled={!!busy || s.kill_switch} onClick={() => act("resume")}><Icon n="play" size={16} />Resume</button>
            : <button className="btn" disabled={!!busy} onClick={() => act("halt")}><Icon n="pause" size={16} />Halt buys</button>}
          <button className="btn btn-danger" disabled={!!busy} onClick={() => act("flatten")}><Icon n="power" size={16} />Flatten</button>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-400">Your account's decisions, sent to Alpaca at {usd(g.capital, 0)} scale. Rust caps every buy; stops and exits always go through.</p>
      {s.halted && <p role="status" className="mt-3 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-red-300">Buys halted: {s.halted}{s.kill_switch ? " (global kill switch is on)" : ""}</p>}
      {(s.sync_error || !s.keys) && <p role="alert" className="mt-3 text-sm text-red-300">{!s.keys ? "Broker keys are not set on the server." : `Broker unreachable: ${s.sync_error}`}</p>}
      {s.drift?.length > 0 && <p className="mt-3 text-sm text-amber-300">Ledger and broker disagree: {s.drift.join("; ")}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat k="Broker equity" v={s.equity == null ? "—" : usd(s.equity)} sub={s.last_sync ? `synced ${time(s.last_sync)}` : "not synced yet"} />
        <Stat k="Today" v={s.day_pnl == null ? "—" : signedUsd(s.day_pnl)} sub={`halts at -${usd(g.max_daily_loss)}`} />
        <Stat k="Deployed" v={usd(s.deployed)} sub={`cap ${usd(g.max_deployed, 0)} · ${usd(g.max_order, 0)}/order`} />
        <Stat k="Orders today" v={`${s.orders_today} / ${g.max_orders_day}`} />
      </div>

      {s.fills?.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1">Time</th><th>Order</th><th>Fill</th><th>vs model</th><th>Status</th></tr></thead>
            <tbody className="font-mono text-slate-300">
              {s.fills.slice(0, 8).map((f: any) => (
                <tr key={f.id + f.ts} className="border-t border-ink-800">
                  <td className="py-1.5">{time(f.ts)}</td>
                  <td>{f.side} {f.notional ? usd(f.notional) + " " : "all "}{f.symbol}</td>
                  <td>{f.fill_price ? usd(f.fill_price) : "—"}</td>
                  <td className={f.slip_bps > 0 ? "text-red-300" : "text-up"}>{f.slip_bps == null ? "—" : `${f.slip_bps > 0 ? "+" : ""}${f.slip_bps.toFixed(0)} bps`}</td>
                  <td>{f.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Mode is set on the server ({mode}). Going live needs BROKER=live plus LIVE_CONFIRM, its own keys and a capital cap: see docs/08_ROADMAP.md.</p>
    </section>
  );
}
