import { useEffect, useMemo, useState } from "react";
import { api, BRAINS, pct, PROFILES, REGIMES, signedUsd, speak, usd, type Ev, type Live, type Profile, type Regime } from "../lib/api";
import { EquityChart, RegimeChart, type Candle, type Marker } from "../components/Charts";
import { LimitsTable, RiskSlider } from "../components/RiskSlider";
import { WhyLog } from "../components/WhyLog";
import { BrainBadge, Empty, Tile } from "../components/ui";
import { Icon } from "../components/Icons";

type MarketRow = { symbol: string; price: number; regime: Regime; regime_label: string; source: string; confidence: number; ai_reason: string | null; feed?: string };

/** `/app` — you watch: chart with regime bands, brains, P&L, goal, positions, why-log, live reasoning, risk slider, controls. */
export default function Dashboard({ acct, feed, reasoning, reload, voice, live = {} }: { acct: any; feed: Ev[]; reasoning: Record<string, string>; reload: () => void; voice: boolean; live?: Live }) {
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []); // "updated Ns ago"
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [sym, setSym] = useState("");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [equity, setEquity] = useState<[number, number][]>([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const f = () => api<MarketRow[]>("/v1/market/regimes").then((m) => { setMarkets(m); setSym((s) => s || m[0]?.symbol || ""); }).catch(() => {});
    f();
    const t = setInterval(f, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (sym) api<Candle[]>(`/v1/market/${sym}/candles?days=400`).then(setCandles).catch(() => setCandles([])); }, [sym]);
  useEffect(() => {
    api("/v1/accounts/me/trades").then((t) => setTrades(t || [])).catch(() => {});
    api<[number, number][]>("/v1/accounts/me/equity").then(setEquity).catch(() => {});
  }, [acct.stats.trades, acct.positions.length, Math.round(acct.equity)]);

  const markers = useMemo<Marker[]>(() => {
    const m: Marker[] = [];
    for (const t of trades.filter((t) => t.symbol === sym)) {
      m.push({ t: t.opened, side: "buy", text: BRAINS[t.brain as keyof typeof BRAINS]?.label ?? "" });
      m.push({ t: t.closed, side: "sell", text: (t.ret >= 0 ? "+" : "") + (t.ret * 100).toFixed(1) + "%" });
    }
    for (const p of acct.positions.filter((p: any) => p.symbol === sym)) m.push({ t: p.opened, side: "buy", text: p.brain_label });
    return m;
  }, [trades, acct.positions, sym]);

  const act = (x: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(x);
    api(`/v1/accounts/me/${x}`, "POST").then(reload).catch((e) => alert(e.message)).finally(() => setBusy(""));
  };
  const setProfile = (p: Profile) => { if (p !== acct.profile) api("/v1/accounts/me/profile", "PATCH", { profile: p }).then(reload).catch((e) => alert(e.message)); };

  const sel = markets.find((m) => m.symbol === sym);
  const goalPct = Math.min(1, acct.goal.progress);
  const s = acct.stats;
  const offline = markets.some((m) => m.feed === "offline");

  return (
    <div className="space-y-5">
      {offline && <div className="rounded-xl border border-wire/40 bg-wire/10 p-3 text-sm text-wire">Live price feed unreachable: showing saved historical data. New buys are blocked (STALE_PRICE) until prices refresh.</div>}

      {/* tiles */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Portfolio value" sub={<span className={acct.pnl_total >= 0 ? "text-up" : "text-down"}>{signedUsd(acct.pnl_total)} all time</span>}>{usd(acct.equity)}</Tile>
        <Tile label="Today" sub={`${usd(acct.exposure, 0)} invested · ${usd(acct.cash, 0)} cash`}>
          <span className={acct.pnl_today >= 0 ? "text-up" : "text-down"}>{signedUsd(acct.pnl_today)}</span>
        </Tile>
        <div className="card p-5">
          <div className="label">Goal · +{usd(acct.goal.amount, 0)} in {acct.goal.months} mo</div>
          <div className="mt-2 text-2xl font-bold text-white num">{pct(acct.goal.progress, 1)}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-label="Goal progress" aria-valuenow={Math.round(goalPct * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-up transition-all" style={{ width: goalPct * 100 + "%" }} />
          </div>
        </div>
        <Tile label="Win rate vs break-even" sub={`${s.trades} closed trades`}>{pct(s.win_rate)} <span className="text-base font-medium text-slate-500">/ {pct(s.breakeven_win_rate)}</span></Tile>
      </section>

      {acct.digest && (
        <section className="card flex items-start gap-3 p-4">
          <Icon n="note" size={18} className="mt-0.5 text-slate-400" />
          <p className="flex-1 text-sm text-slate-300"><b className="text-white">Today: </b>{acct.digest}</p>
          {voice && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => speak(acct.digest, true)}><Icon n="volume" size={14} />Listen</button>}
        </section>
      )}

      {/* coins: brain per coin */}
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Markets">
        {markets.map((m) => (
          <button key={m.symbol} onClick={() => setSym(m.symbol)} aria-pressed={sym === m.symbol}
            className={"card p-4 text-left transition hover:border-slate-500 " + (sym === m.symbol ? "ring-2 ring-offset-2 ring-offset-ink-950" : "")}
            style={sym === m.symbol ? { ["--tw-ring-color" as any]: REGIMES[m.regime].color } : undefined}>
            <div className="flex items-center justify-between"><b className="text-white">{m.symbol}</b><LivePrice price={live[m.symbol]?.price ?? m.price} prev={live[m.symbol]?.prev} /></div>
            <div className="mt-3"><BrainBadge regime={m.regime} /></div>
            <div className="mt-2 text-xs text-slate-400">
              {m.regime_label} market · {m.source === "ai" ? `AI agrees, ${pct(m.confidence)} confident` : m.source === "override_rejected" ? "AI overruled by Rust" : "rule-based"}
            </div>
          </button>
        ))}
      </section>

      {/* chart + reasoning */}
      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="flex items-center gap-3 font-semibold text-white">{sym || "…"} · daily <LiveBadge ts={live[sym]?.ts} /></h2>
            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              {(Object.keys(REGIMES) as Regime[]).map((r) => (
                <span key={r} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: REGIMES[r].color + "66" }} />{REGIMES[r].label} · {BRAINS[REGIMES[r].brain].label}</span>
              ))}
            </div>
          </div>
          {candles.length ? <RegimeChart data={candles} markers={markers} live={live[sym]?.bar} /> : <div className="grid h-[360px] place-items-center text-sm text-slate-500">Loading chart…</div>}
        </div>
        <div className="card flex flex-col p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Why this brain</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-violet-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />Regime Agent</span>
          </div>
          {sel && (
            <>
              <div className="mt-4"><BrainBadge regime={sel.regime} /></div>
              <p className="mt-3 text-sm text-slate-300">{BRAINS[REGIMES[sel.regime].brain].does}.</p>
              {sel.source === "ai" && sel.ai_reason && <p className="mt-3 rounded-lg bg-violet-400/10 p-3 text-sm text-violet-100">“{sel.ai_reason}”</p>}
              {sel.source === "override_rejected" && <p className="mt-3 text-sm text-down">The AI's call contradicted the data, so Rust kept its own regime (REGIME_MISMATCH).</p>}
            </>
          )}
          <div className="mt-4 flex-1">
            <div className="label">Live reasoning</div>
            {reasoning[sym]
              ? <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-300" aria-live="polite">{reasoning[sym]}<span className="animate-pulse">▍</span></p>
              : <p className="mt-2 text-sm text-slate-500">The agent's thinking streams here token by token when it re-reads the market (every 15 min). If it's down, Rust keeps trading on its own rules.</p>}
          </div>
        </div>
      </section>

      {/* equity + risk controls */}
      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-2 px-1 font-semibold text-white">Portfolio value</h2>
          <EquityChart points={equity} start={acct.start_cash} />
        </div>
        <div className="card p-5">
          <h2 className="font-semibold text-white">Your risk</h2>
          <div className="mt-5"><RiskSlider value={acct.profile as Profile} onChange={setProfile} /></div>
          <div className="mt-3"><LimitsTable profile={acct.profile as Profile} compact /></div>
          <p className="mt-3 text-xs text-slate-500">{PROFILES[acct.profile as Profile]?.blurb}</p>
        </div>
      </section>

      {/* positions + why-log */}
      <section className="grid gap-5 lg:grid-cols-5">
        <div className="card p-5 lg:col-span-3">
          <h2 className="font-semibold text-white">Positions</h2>
          {acct.positions.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr><th className="py-2 font-medium">Coin</th><th className="font-medium">Brain</th><th className="text-right font-medium">Value</th><th className="text-right font-medium">P&L</th><th className="text-right font-medium">Stop</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-700">
                  {acct.positions.map((p: any) => (
                    <tr key={p.symbol} className="align-top">
                      <td className="py-3"><b className="text-white">{p.symbol}</b>{p.thesis && <p className="mt-1 max-w-xs text-xs text-slate-400">{p.thesis.reason}</p>}</td>
                      <td className="py-3"><BrainBadge regime={p.regime} size="sm" /></td>
                      <td className="py-3 text-right num">{usd(p.value)}</td>
                      <td className={"py-3 text-right num " + (p.pnl >= 0 ? "text-up" : "text-down")}>{signedUsd(p.pnl)}</td>
                      <td className="py-3 text-right text-slate-400 num">{usd(p.stop)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="mt-3"><Empty>No positions right now. The AI is waiting for its setup, or holding cash on purpose.</Empty></div>}

          <div className="mt-6 border-t border-ink-700 pt-5">
            <h3 className="label">Controls</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {acct.status === "active"
                ? <button className="btn" disabled={!!busy} onClick={() => act("pause")}><Icon n="pause" size={16} />Pause</button>
                : <button className="btn" disabled={!!busy} onClick={() => act("resume")}><Icon n="play" size={16} />Resume</button>}
              <button className="btn" disabled={!!busy || !acct.positions.length} onClick={() => act("flatten", "Sell every position now at market?")}><Icon n="sell" size={16} />Sell everything</button>
              <button className="btn btn-danger" disabled={!!busy || acct.status === "killed"} onClick={() => act("kill", "Turn on the kill switch? No new orders until you resume.")}><Icon n="power" size={16} />Kill switch</button>
              <button className="btn border-wire/40 text-wire hover:border-wire" disabled={!!busy} onClick={() => act("agent-loosen")} title="Demo: the AI asks to double its own risk after a loss. Rust refuses.">
                <Icon n="shieldOff" size={16} />Let AI raise its risk
              </button>
            </div>
          </div>
        </div>
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold text-white">Why-log</h2>
          <WhyLog items={feed} limit={40} />
        </div>
      </section>
      <p className="text-center text-xs text-slate-600">Paper trading only. Not financial advice. Charts by <a className="underline" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts.</p>
    </div>
  );
}

/** Price that flashes green/red on each live tick. */
function LivePrice({ price, prev }: { price: number; prev?: number }) {
  const dir = prev == null || price === prev ? "" : price > prev ? "text-up" : "text-down";
  return <span key={price} className={"rise text-sm num " + (dir || "text-slate-300")} aria-live="polite">{usd(price)}</span>;
}

/** "● Live · 4s ago" while ticks arrive; "Delayed" when they stop. */
function LiveBadge({ ts }: { ts?: number }) {
  if (!ts) return <span className="text-xs font-medium text-slate-500">waiting for live prices…</span>;
  const age = Math.max(0, Math.round(Date.now() / 1000 - ts));
  const fresh = age < 45;
  return (
    <span className={"inline-flex items-center gap-1.5 text-xs font-medium " + (fresh ? "text-up" : "text-wire")}>
      <span className={"h-1.5 w-1.5 rounded-full " + (fresh ? "animate-pulse bg-up" : "bg-wire")} />
      {fresh ? `Live · ${age}s ago` : `Delayed · ${age}s`}
    </span>
  );
}
