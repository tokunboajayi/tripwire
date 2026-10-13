import { useCallback, useEffect, useState } from "react";
import { api, time, usd } from "../lib/api";
import { Icon } from "./Icons";

const STATUS: Record<string, string> = {
  taken: "Taken", PAIR_UNVERIFIED: "Not verified", POLY_LIVE_UNSUPPORTED: "Polymarket: paper only", NO_CASH: "No cash on venue",
  PM_EXPOSURE_CAP: "Exposure cap", RATE_LIMIT: "Rate limit", PM_HALTED: "Halted",
};

/** Owner-only panel for the Kalshi + Polymarket arbitrage engine (PM_MODE=paper|live). */
export function PredictionArb() {
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api("/v1/pm").then(setS, (e) => { if (e.status === 403 || e.status === 404) setS(false); }), []);
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);
  if (!s) return null;

  const st = s.state, live = s.mode === "live";
  const act = async (a: string) => { setBusy(true); try { setS(await api(`/v1/pm/${a}`, "POST")); } finally { setBusy(false); } };
  const realized = Object.values(st.realized ?? {}).reduce((a: number, b: any) => a + b, 0) as number;
  const Stat = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
    <div className="rounded-lg border border-ink-700 bg-ink-950 p-3"><div className="text-xs text-slate-400">{k}</div><div className="mt-1 font-mono text-white">{v}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>
  );

  return (
    <section className={"card p-6 " + (live ? "border-down/40" : "")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Icon n="target" size={18} className="text-wire" />Prediction-market arbitrage
          <span className={"rounded px-2 py-0.5 font-mono text-xs " + (live ? "bg-down/20 text-red-300" : "bg-wire/15 text-wire")}>{live ? "LIVE · KALSHI" : "PAPER"}</span>
        </h2>
        {st.halted ? <button className="btn" disabled={busy} onClick={() => act("resume")}><Icon n="play" size={16} />Resume</button>
          : <button className="btn" disabled={busy} onClick={() => act("halt")}><Icon n="pause" size={16} />Halt</button>}
      </div>
      <p className="mt-2 text-sm text-slate-400">Buys both sides of the same event when they cost less than the $1 payout after fees. Checks {st.markets} markets every {s.cfg.every_ms} ms ({st.cycle_ms} ms last pass).</p>
      {st.halted && <p role="status" className="mt-3 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-red-300">Halted: {st.halted}</p>}
      {st.error && <p className="mt-3 text-sm text-amber-300">{st.error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat k="Locked profit" v={usd(st.locked)} sub="paid when markets settle" />
        <Stat k="Realised" v={usd(realized)} sub={`${st.settled.length} sets settled`} />
        <Stat k="Capital in sets" v={usd(s.exposure)} sub={`cap ${usd(s.cfg.max_exposure_usd, 0)} · ${usd(s.cfg.max_arb_usd, 0)}/set`} />
        <Stat k="Cash" v={Object.entries(st.balances).map(([v, b]: any) => `${v[0].toUpperCase()} ${usd(b, 0)}`).join(" · ") || "—"} />
      </div>

      {st.opps.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-slate-300">Latest opportunities</h3>
          <table className="mt-1 w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1">Time</th><th>Event</th><th>Legs</th><th>Edge</th><th>Profit</th><th>Result</th></tr></thead>
            <tbody className="text-slate-300">
              {st.opps.slice(0, 8).map((o: any, i: number) => (
                <tr key={i} className="border-t border-ink-800">
                  <td className="py-1.5 font-mono">{time(o.ts)}</td><td>{o.arb.label}</td>
                  <td className="font-mono text-xs">{o.arb.legs.map((l: any) => `${l.side.toUpperCase()} ${Math.round(l.price * 100)}¢ ${l.venue[0].toUpperCase()}`).join(" + ")}</td>
                  <td className="font-mono">{(o.arb.edge_bps / 100).toFixed(1)}%</td><td className="font-mono text-up">+{usd(o.arb.profit)}</td>
                  <td className={o.status === "taken" ? "text-up" : "text-slate-400"}>{STATUS[o.status] ?? o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {s.allocation?.weights?.length > 0 && (
        <div className="mt-4 text-sm">
          <h3 className="font-semibold text-slate-300">Where the money should be</h3>
          <p className="mt-1 font-mono text-slate-300">{s.allocation.weights.map((w: any) => `${w[0]} ${Math.round(w[1] * 100)}%`).join(" · ")}</p>
          {s.allocation.transfers.map((t: any, i: number) => <p key={i} className="text-amber-300">Move {usd(t.usd, 0)} from {t.from} to {t.to}</p>)}
          <p className="text-xs text-slate-500">Transfers between brokers are done by you; the engine never moves money off a venue.</p>
        </div>
      )}
    </section>
  );
}
