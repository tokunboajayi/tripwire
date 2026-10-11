import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Lines } from "../components/Charts";

const CURVES: [string, string, string][] = [["buy_hold", "Buy & hold", "#94A3B8"], ["conservative", "Conservative", "#60A5FA"], ["balanced", "Balanced", "#34D399"], ["aggressive", "Aggressive", "#F5B841"]];

/** `/backtest` — v2 curve vs buy & hold, headline table, honest caveats. Public. */
export default function Backtest() {
  const [bt, setBt] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/v1/backtest").then(setBt).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="card p-6 text-sm text-slate-400">Backtest data not found. Run <code>python backtest/export_json.py</code>.</div>;
  if (!bt) return <div className="card p-6 text-sm text-slate-400">Loading backtest…</div>;
  const h = bt.headline;
  const stats: [string, string, string][] = [
    ["Crypto market 2025–26", `${h.oos_market}%`, "text-down"],
    ["Vantrel 2025–26 (held out)", `+${h.oos_conservative}% to +${h.oos_aggressive}%`, "text-up"],
    ["Worst drop · Vantrel", `${h.maxdd_conservative}%`, "text-white"],
    ["Worst drop · buy & hold", `${h.maxdd_buy_hold}%`, "text-down"],
    ["Win rate / break-even", `${h.win_rate}% / ${h.breakeven_win_rate}%`, "text-white"],
  ];
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-bold text-white">Backtest 2022 → 2026</h1>
        <p className="mt-1 text-slate-400">{bt.assets.join(", ")} daily bars. {(bt.fee_per_side * 100).toFixed(2)}% fee per side, slippage included. 2022–24 was used to design the rules; 2025–26 was held out.</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map(([l, v, c]) => <div key={l} className="card p-5"><div className="label">{l}</div><div className={"mt-2 text-xl font-bold num " + c}>{v}</div></div>)}
      </section>
      <section className="card p-4">
        <h2 className="mb-2 px-1 font-semibold text-white">Growth of $1 (%)</h2>
        <Lines height={340} series={CURVES.filter(([k]) => bt.curves[k]).map(([k, name, color]) => ({ name, color, thin: k === "buy_hold", points: bt.curves[k].map(([t, v]: [number, number]) => [t, (v - 1) * 100]) }))} />
      </section>
      <section className="card p-5 text-sm text-slate-400">
        <h2 className="mb-2 font-semibold text-white">Honest caveats</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>{h.trades} trades is a small sample.</li>
          <li>It trails buy & hold in strong bull runs. It's built to protect: in downtrends the Shield holds cash.</li>
          <li>Win rate is below 50% on purpose. What matters is staying above the break-even win rate, because winners are bigger than losers.</li>
          <li>Past results don't predict future returns. Paper trading only.</li>
          <li>Charts by <a className="underline" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts.</li>
        </ul>
      </section>
    </div>
  );
}
