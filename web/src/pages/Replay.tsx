import { api, type Ev } from "../lib/api";
import { Lines } from "../components/Charts";
import { Icon } from "../components/Icons";
import { Empty } from "../components/ui";

export type ReplayTick = { t: number; equity: number; buy_hold: number };
const START = 10_000;

/** `/replay` — the same engine on real history, sped up: "watch it survive 2025". */
export default function Replay({ ticks, events, running, stocks, start }: { ticks: ReplayTick[]; events: Ev[]; running: boolean; stocks: boolean; start: (dataset: string) => void }) {
  const last = ticks[ticks.length - 1];
  const series = (k: "equity" | "buy_hold") => ticks.map((r) => [r.t, (r[k] / START - 1) * 100] as [number, number]);
  const ret = (v: number) => ((v / START - 1) * 100).toFixed(1) + "%";
  return (
    <div className="space-y-5">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">Replay: watch it trade real history</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400">Same Rust brains and risk rules as live, fed real daily prices at high speed. No look-ahead: each day it only sees what was known that day. $10,000 start, 0.25% fee + 0.05% slippage per side.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={running} onClick={() => start("crypto")}><Icon n="play" size={16} />Crypto 2025 → today</button>
            {stocks && <button className="btn" disabled={running} onClick={() => start("stocks")}><Icon n="play" size={16} />Stocks 2024 → today</button>}
          </div>
        </div>
        {last && (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div><div className="label">Tripwire</div><div className={"mt-1 text-3xl font-bold num " + (last.equity >= START ? "text-up" : "text-down")}>{ret(last.equity)}</div></div>
            <div><div className="label">Buy & hold</div><div className={"mt-1 text-3xl font-bold num " + (last.buy_hold >= START ? "text-up" : "text-down")}>{ret(last.buy_hold)}</div></div>
            <div><div className="label">{running ? "Replaying" : "Finished"}</div><div className="mt-1 text-lg font-semibold text-slate-300">{new Date(last.t * 1000).toLocaleDateString()}</div></div>
          </div>
        )}
        <div className="mt-6">
          {ticks.length ? <Lines series={[{ name: "Tripwire", color: "#34D399", points: series("equity") }, { name: "Buy & hold", color: "#94A3B8", points: series("buy_hold"), thin: true }]} />
            : <Empty>Press play. The chart fills in as the engine trades through each day.</Empty>}
        </div>
      </section>
      {events.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold text-white">Replay trades</h2>
          <ol className="max-h-80 space-y-1.5 overflow-y-auto text-sm">
            {events.map((e) => <li key={e.id} className="text-slate-300"><span className="mr-2 text-xs text-slate-500">{new Date(e.ts * 1000).toLocaleTimeString()}</span>{e.msg}</li>)}
          </ol>
        </section>
      )}
    </div>
  );
}

export const startReplay = (dataset: string) =>
  api("/v1/replays", "POST", { speed: dataset === "stocks" ? 60 : 40, dataset, from: dataset === "stocks" ? "2024-01-01" : "2025-01-01" });
