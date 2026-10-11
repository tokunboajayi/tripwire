import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, BRAINS, pct, PROFILES, REGIMES, signedPct, signedUsd, speak, usd, type Brain, type Ev, type Live, type Profile, type Regime } from "../lib/api";
import { EquityChart, Lines, RegimeChart, type Candle, type Marker } from "../components/Charts";
import { LimitsTable, RiskSlider } from "../components/RiskSlider";
import { WhyLog } from "../components/WhyLog";
import { BrainBadge, Empty } from "../components/ui";
import { Icon } from "../components/Icons";
import type { Demo } from "./Replay";

type MarketRow = { symbol: string; price: number; regime: Regime; regime_label: string; source: string; confidence: number; ai_reason: string | null; feed?: string };

const DEMO_FROM = 1735689600; // 2025-01-01 UTC, start of the held-out period
const DEMO_CASH = 10_000;

/** `/app` — the active brain up top, the market it's reading, every decision with its reason, and your controls. */
export default function Dashboard({ acct, feed, reasoning, reload, voice, live = {}, demo, cfg = {} }: {
  acct: any; feed: Ev[]; reasoning: Record<string, string>; reload: () => void; voice: boolean; live?: Live; demo: Demo; cfg?: any;
}) {
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []); // "updated Ns ago"
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [sym, setSym] = useState("");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [equity, setEquity] = useState<[number, number][]>([]);
  const [busy, setBusy] = useState("");
  const [demoView, setDemoView] = useState(false);

  useEffect(() => {
    const f = () => api<MarketRow[]>("/v1/market/regimes").then((m) => { setMarkets(m); setSym((s) => s || m[0]?.symbol || ""); }).catch(() => {});
    f();
    const t = setInterval(f, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (sym) api<Candle[]>(`/v1/market/${sym}/candles?days=900`).then(setCandles).catch(() => setCandles([])); }, [sym]);
  useEffect(() => {
    api("/v1/accounts/me/trades").then((t) => setTrades(t || [])).catch(() => {});
    api<[number, number][]>("/v1/accounts/me/equity").then(setEquity).catch(() => {});
  }, [acct.stats.trades, acct.positions.length, Math.round(acct.equity)]);
  useEffect(() => { if (demo.running) setDemoView(true); }, [demo.running]);

  const act = (x: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(x);
    api(`/v1/accounts/me/${x}`, "POST").then(reload).catch((e) => alert(e.message)).finally(() => setBusy(""));
  };
  const setProfile = (p: Profile) => { if (p !== acct.profile) api("/v1/accounts/me/profile", "PATCH", { profile: p }).then(reload).catch((e) => alert(e.message)); };
  const startDemo = () => { setDemoView(true); demo.start(); scrollTo({ top: 0, behavior: "smooth" }); };
  const exitDemo = () => { if (demo.running) demo.stop(); demo.reset(); setDemoView(false); };

  // ---- what the dashboard shows: live account, or the 2025 replay ----
  const tick = demo.ticks[demo.ticks.length - 1];
  const inDemo = demoView && (demo.running || demo.ticks.length > 0);
  const sel = markets.find((m) => m.symbol === sym);
  const activeRegime: Regime | undefined = inDemo ? (tick?.regimes?.[sym]?.regime as Regime | undefined) : sel?.regime;

  // base stays referentially stable for the whole replay (a new array would rebuild the chart every tick);
  // only the stream grows as replay days arrive
  const chartData = useMemo(() => (inDemo ? candles.filter((c) => c.t < DEMO_FROM).slice(-120) : candles), [candles, inDemo]);
  const chartStream = useMemo(() => (inDemo && tick ? candles.filter((c) => c.t >= DEMO_FROM && c.t <= tick.t) : undefined), [candles, inDemo, tick?.t]);

  const markers = useMemo<Marker[]>(() => {
    if (inDemo) {
      return demo.events.filter((e) => e.kind === "replay_order" && e.data?.symbol === sym && e.data?.t).map((e) => ({
        t: e.data.t, side: e.data.side,
        text: e.data.side === "buy" ? BRAINS[e.data.brain as Brain]?.label ?? "" : (e.data.ret >= 0 ? "+" : "") + (e.data.ret * 100).toFixed(1) + "%",
      }));
    }
    const m: Marker[] = [];
    for (const t of trades.filter((t) => t.symbol === sym)) {
      m.push({ t: t.opened, side: "buy", text: BRAINS[t.brain as Brain]?.label ?? "" });
      m.push({ t: t.closed, side: "sell", text: (t.ret >= 0 ? "+" : "") + (t.ret * 100).toFixed(1) + "%" });
    }
    for (const p of acct.positions.filter((p: any) => p.symbol === sym)) m.push({ t: p.opened, side: "buy", text: p.brain_label });
    return m;
  }, [inDemo, demo.events, trades, acct.positions, sym]);

  // replay events rendered by the normal why-log
  const demoLog = useMemo(() => demo.events.map((e) => ({
    ...e, kind: e.kind === "replay_order" ? "order" : "regime",
    msg: e.data?.t ? `${new Date(e.data.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${e.msg}` : e.msg,
  })), [demo.events]);
  const demoStats = useMemo(() => {
    const rets = demo.events.filter((e) => e.kind === "replay_order" && e.data?.side === "sell").map((e) => e.data.ret as number);
    return { n: rets.length, wins: rets.filter((r) => r > 0).length, best: Math.max(0, ...rets), worst: Math.min(0, ...rets) };
  }, [demo.events]);
  const lastSwitch = inDemo ? demo.events.find((e) => e.kind === "replay_regime" && e.data?.symbol === sym)
    : feed.find((e) => e.kind === "regime" && e.data?.symbol === sym);

  const offline = markets.some((m) => m.feed === "offline");
  const coins = markets.map((m) => ({ symbol: m.symbol, regime: (inDemo ? tick?.regimes?.[m.symbol]?.regime : m.regime) as Regime | undefined,
    price: inDemo ? tick?.regimes?.[m.symbol]?.price : live[m.symbol]?.price ?? m.price, prev: inDemo ? undefined : live[m.symbol]?.prev }));

  return (
    <div className="space-y-5">
      {offline && !inDemo && <div className="rounded-xl border border-wire/40 bg-wire/10 p-3 text-sm text-wire">Live price feed unreachable: showing saved historical data. New buys are blocked (STALE_PRICE) until prices refresh.</div>}

      {/* ---------- hero: which brain is driving, how you're doing, the demo button ---------- */}
      <Hero regime={activeRegime}>
        <div className="grid items-center gap-6 lg:grid-cols-[1.35fr_1fr_auto]">
          <div>
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Coin">
              {coins.map((c) => (
                <button key={c.symbol} role="tab" aria-selected={sym === c.symbol} onClick={() => setSym(c.symbol)}
                  className={"inline-flex min-h-[36px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition " + (sym === c.symbol ? "border-white/40 bg-white/10 text-white" : "border-ink-600 text-slate-400 hover:text-white")}>
                  <i className="h-2 w-2 rounded-full" style={{ background: c.regime ? REGIMES[c.regime].color : "#475569" }} />
                  {c.symbol}
                  {c.price != null && (inDemo
                    ? <span className="text-xs font-medium text-slate-300 num">{usd(c.price, c.price >= 1000 ? 0 : 2)}</span>
                    : <LivePrice price={c.price} prev={c.prev} small />)}
                </button>
              ))}
            </div>
            <div className="mt-4 label">{inDemo ? "Brain in charge on this day" : "Brain in charge now"}</div>
            {activeRegime ? (
              <>
                <div key={activeRegime} className="rise mt-1 flex items-center gap-3 text-4xl font-bold tracking-tight sm:text-5xl" style={{ color: REGIMES[activeRegime].color, textShadow: `0 0 28px ${REGIMES[activeRegime].color}55` }}>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border sm:h-14 sm:w-14" style={{ borderColor: REGIMES[activeRegime].color + "66", background: REGIMES[activeRegime].color + "14" }}>
                    <Icon n={BRAINS[REGIMES[activeRegime].brain].glyph} size={30} />
                  </span>
                  {BRAINS[REGIMES[activeRegime].brain].label}
                </div>
                <p className="mt-2 text-sm text-slate-300">
                  <b className="text-white">{REGIMES[activeRegime].label}</b> market · {BRAINS[REGIMES[activeRegime].brain].does.toLowerCase()}.
                  {!inDemo && sel && <span className="text-slate-400"> {sel.source === "ai" ? `Regime Agent agrees (${pct(sel.confidence)} confident).` : sel.source === "override_rejected" ? "AI overruled by Rust (REGIME_MISMATCH)." : "Rule-based call."}</span>}
                </p>
              </>
            ) : <div className="mt-1 text-4xl font-extrabold text-slate-400">…</div>}
          </div>

          <div className="lg:border-l lg:border-white/10 lg:pl-6">
            {inDemo ? (
              <>
                <div className="label">2025 → {tick ? new Date(tick.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "…"}</div>
                <ScoreRow label="Vantrel" value={tick ? tick.equity / DEMO_CASH - 1 : 0} />
                <ScoreRow label="Just holding" value={tick ? tick.buy_hold / DEMO_CASH - 1 : 0} muted />
                <p className="mt-2 text-xs text-slate-400">$10,000 paper, fees included. Same Rust engine, real daily prices, no look-ahead.</p>
              </>
            ) : (
              <>
                <div className="label">Portfolio value</div>
                <div className="mt-1 text-3xl font-bold text-white num">{usd(acct.equity)}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-sm num">
                  <span className={pnlTone(acct.pnl_today)}>{signedUsd(acct.pnl_today)} today</span>
                  <span className={pnlTone(acct.pnl_total)}>{signedUsd(acct.pnl_total)} all time</span>
                </div>
                <RiskWire acct={acct} />
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                  <div className="h-1 w-16 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-label="Goal progress" aria-valuenow={Math.round(Math.min(1, acct.goal.progress) * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-up" style={{ width: Math.min(100, acct.goal.progress * 100) + "%" }} />
                  </div>
                  Goal +{usd(acct.goal.amount, 0)} in {acct.goal.months} mo · {pct(acct.goal.progress, 1)}
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col items-stretch gap-2 lg:w-56">
            {!inDemo && (
              <>
                <button className="btn btn-primary px-5 py-3 text-base" onClick={startDemo}><Icon n="play" size={18} />Watch it survive 2025</button>
                <p className="text-center text-xs text-slate-400">One-minute replay of the 2025 crypto drop, right here on this dashboard.</p>
              </>
            )}
            {inDemo && demo.running && (
              <>
                <DemoProgress t={tick?.t} />
                <button className="btn" onClick={exitDemo}><Icon n="pause" size={16} />Stop and go live</button>
              </>
            )}
            {inDemo && !demo.running && (
              <>
                <button className="btn btn-primary" onClick={startDemo}><Icon n="refresh" size={16} />Replay again</button>
                <button className="btn" onClick={exitDemo}>Back to live</button>
              </>
            )}
          </div>
        </div>
        {lastSwitch && (
          <div key={lastSwitch.id + ":" + lastSwitch.ts} role={inDemo ? undefined : "status"} className="rise mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200">
            <Icon n="refresh" size={16} className="text-sky-300" />
            <span className="truncate">{inDemo && lastSwitch.data?.t ? new Date(lastSwitch.data.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " : ""}{lastSwitch.msg}</span>
          </div>
        )}
      </Hero>

      {/* ---------- the market it's reading + every decision ---------- */}
      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="flex items-center gap-3 font-semibold text-white">{sym || "…"} · daily {inDemo ? <span className="text-xs font-medium text-wire">Replay</span> : <LiveBadge ts={live[sym]?.ts} />}</h2>
            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              {(Object.keys(REGIMES) as Regime[]).map((r) => (
                <span key={r} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: REGIMES[r].color }} />{BRAINS[REGIMES[r].brain].label}</span>
              ))}
            </div>
          </div>
          {candles.length ? <RegimeChart data={chartData} stream={chartStream} markers={markers} live={inDemo ? undefined : live[sym]?.bar}
              wires={inDemo ? [] : acct.positions.filter((p: any) => p.symbol === sym).map((p: any) => ({ price: p.stop, title: "STOP" }))} />
            : <div className="grid h-[380px] place-items-center text-sm text-slate-400">Loading chart…</div>}
        </div>
        <div className="card flex max-h-[470px] flex-col p-5">
          <h2 className="mb-3 font-semibold text-white">{inDemo ? "What it did, 2025 → today" : "Why-log"}</h2>
          <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
            <WhyLog items={inDemo ? demoLog : feed} limit={60} filters={!inDemo} live={!inDemo} />
          </div>
        </div>
      </section>

      {/* ---------- reasoning · risk · you ---------- */}
      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card flex flex-col p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Why this brain</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-violet-300"><span className="h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-violet-400" />Regime Agent</span>
          </div>
          {activeRegime && <div className="mt-3"><BrainBadge regime={activeRegime} /></div>}
          {!inDemo && sel?.source === "ai" && sel.ai_reason && <p className="mt-3 rounded-lg bg-violet-400/10 p-3 text-sm text-violet-100">“{sel.ai_reason}”</p>}
          {!inDemo && sel?.source === "override_rejected" && <p className="mt-3 text-sm text-down">The AI's call contradicted the data, so Rust kept its own regime (REGIME_MISMATCH).</p>}
          <div className="mt-3 flex-1">
            <div className="label">Live reasoning</div>
            {reasoning[sym]
              ? <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-300">{reasoning[sym]}<span className="motion-safe:animate-pulse">▍</span></p>
              : <p className="mt-2 text-sm text-slate-400">The agent's thinking streams here when it re-reads the market. If it's down, Rust keeps trading on its own rules.</p>}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-white">Your risk</h2>
          <div className="mt-5"><RiskSlider value={acct.profile as Profile} onChange={setProfile} /></div>
          <div className="mt-3"><LimitsTable profile={acct.profile as Profile} compact /></div>
          <button className="btn mt-4 w-full border-wire/40 text-wire hover:border-wire" disabled={!!busy} onClick={() => act("agent-loosen")} title="The AI asks to double its own risk after a loss. Rust refuses.">
            <Icon n="shieldOff" size={16} />Let the AI raise its own risk
          </button>
          <p className="mt-2 text-xs text-slate-400">{PROFILES[acct.profile as Profile]?.blurb}</p>
        </div>

        <div className="card flex flex-col gap-4 p-5">
          <div>
            <h2 className="font-semibold text-white">{inDemo ? "Replay track record" : "Track record"}</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {inDemo ? (
                <>
                  <Stat label="Closed trades" value={String(demoStats.n)} />
                  <Stat label="Win rate" value={demoStats.n ? pct(demoStats.wins / demoStats.n) : "–"} />
                  <Stat label="Best trade" value={demoStats.n ? signedPct(demoStats.best) : "–"} tone={1} />
                  <Stat label="Worst trade" value={demoStats.n ? signedPct(demoStats.worst) : "–"} tone={-1} />
                </>
              ) : (
                <>
                  <Stat label="Win rate" value={pct(acct.stats.win_rate)} />
                  <Stat label="Break-even" value={pct(acct.stats.breakeven_win_rate)} />
                  <Stat label="Closed trades" value={String(acct.stats.trades)} />
                  <Stat label="Invested" value={usd(acct.exposure, 0)} />
                </>
              )}
            </div>
          </div>
          {acct.digest && <p className="rounded-lg bg-ink-850 p-3 text-sm text-slate-300"><b className="text-white">Today: </b>{acct.digest}</p>}
          <div className="mt-auto grid gap-2">
            {voice && <button className="btn" onClick={() => speak(acct.digest || reportText(acct, markets), true)}><Icon n="volume" size={16} />Hear today's report</button>}
          </div>
        </div>
      </section>

      {/* ---------- money ---------- */}
      <section className="grid gap-5 lg:grid-cols-5">
        <div className="card p-4 lg:col-span-3">
          <h2 className="mb-2 px-1 font-semibold text-white">{inDemo ? "2025 → today: Vantrel vs just holding" : "Portfolio value"}</h2>
          {inDemo
            ? <Lines height={220} series={[
                { name: "Vantrel", color: "#34D399", points: demo.ticks.map((r) => [r.t, (r.equity / DEMO_CASH - 1) * 100] as [number, number]) },
                { name: "Just holding", color: "#94A3B8", thin: true, points: demo.ticks.map((r) => [r.t, (r.buy_hold / DEMO_CASH - 1) * 100] as [number, number]) }]} />
            : <EquityChart points={equity} start={acct.start_cash} />}
        </div>
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-white">Positions</h2>
          {acct.positions.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="py-2 font-medium">Coin</th><th className="font-medium">Brain</th><th className="text-right font-medium">P&L</th><th className="text-right font-medium">Stop</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-700">
                  {acct.positions.map((p: any) => (
                    <tr key={p.symbol} className="align-top">
                      <td className="py-3"><b className="text-white">{p.symbol}</b> <span className="text-slate-400 num">{usd(p.value, 0)}</span>{p.thesis && <p className="mt-1 max-w-xs text-xs text-slate-400">{p.thesis.reason}</p>}</td>
                      <td className="py-3"><BrainBadge regime={p.regime} size="sm" /></td>
                      <td className={"py-3 text-right num " + (p.pnl >= 0 ? "text-up" : "text-down")}>{signedUsd(p.pnl)}</td>
                      <td className="py-3 text-right text-slate-400 num">{usd(p.stop)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3"><Empty>
              No positions right now: the AI is waiting for its setup, or holding cash on purpose.
              {!inDemo && <button className="mt-3 block w-full text-sm font-semibold text-up hover:underline" onClick={startDemo}>See how it trades: watch 2025 →</button>}
            </Empty></div>
          )}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-ink-700 pt-4">
            {acct.status === "active"
              ? <button className="btn" disabled={!!busy} onClick={() => act("pause")}><Icon n="pause" size={16} />Pause</button>
              : <button className="btn" disabled={!!busy} onClick={() => act("resume")}><Icon n="play" size={16} />Resume</button>}
            <button className="btn" disabled={!!busy || !acct.positions.length} onClick={() => act("flatten", "Sell every position now at market?")}><Icon n="sell" size={16} />Sell all</button>
            <button className="btn btn-danger" disabled={!!busy || acct.status === "killed"} onClick={() => act("kill", "Turn on the kill switch? No new orders until you resume.")}><Icon n="power" size={16} />Kill switch</button>
          </div>
        </div>
      </section>
      <p className="text-center text-xs text-slate-400">Paper trading only. Not financial advice. Charts by <a className="underline" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts.</p>
    </div>
  );
}

/** Card tinted with the active brain's color. */
function Hero({ regime, children }: { regime?: Regime; children: ReactNode }) {
  const c = regime ? REGIMES[regime].color : "#334155";
  return (
    <section className="card relative overflow-hidden p-6 motion-safe:transition-colors motion-safe:duration-700" style={{ borderColor: c + "66", background: `radial-gradient(120% 140% at 0% 0%, ${c}26 0%, transparent 55%), #0B1220` }}>
      <div className="wire absolute inset-x-0 top-0" aria-hidden />
      {children}
    </section>
  );
}

const pnlTone = (v: number) => (v > 0.005 ? "text-up" : v < -0.005 ? "text-down" : "text-slate-400");

/** The tripwire, made visible: today's loss against the daily limit that auto-pauses trading. */
function RiskWire({ acct }: { acct: any }) {
  const limit = acct.limits.daily_loss;
  const startOfDay = acct.equity - acct.pnl_today;
  const loss = startOfDay > 0 ? Math.max(0, -acct.pnl_today / startOfDay) : 0;
  const used = Math.min(1, loss / limit);
  const tone = used >= 1 ? "bg-down" : used > 0.6 ? "bg-wire" : "bg-slate-300";
  return (
    <div className="mt-4" role="meter" aria-label="Daily loss against the auto-pause limit" aria-valuemin={0} aria-valuemax={limit * 100} aria-valuenow={+(Math.min(loss, limit) * 100).toFixed(2)} aria-valuetext={`today −${(loss * 100).toFixed(2)}%, pause at −${(limit * 100).toFixed(1)}%`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[11px] uppercase tracking-[0.12em]">
        <span className="whitespace-nowrap text-slate-400">Risk wire</span>
        <span className="whitespace-nowrap text-slate-300">today −{(loss * 100).toFixed(2)}% <span className="text-wire">/ pause at −{(limit * 100).toFixed(1)}%</span></span>
      </div>
      <div className="relative mt-2 h-2.5">
        <div className="absolute inset-y-[4px] left-0 right-0 rounded-full bg-ink-700" />
        <div className={"absolute inset-y-[4px] left-0 rounded-full " + tone} style={{ width: Math.max(used * 100, used > 0 ? 2 : 0) + "%" }} />
        <div className="absolute inset-y-0 right-0 w-[3px] rounded-full bg-wire shadow-[0_0_10px_#F5B841]" title="Auto-pause line" />
      </div>
    </div>
  );
}

function ScoreRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="mt-2 flex items-baseline justify-between gap-4">
      <span className={muted ? "text-sm text-slate-400" : "text-sm font-semibold text-white"}>{label}</span>
      <span className={"num font-bold " + (muted ? "text-xl " : "text-3xl ") + (value >= 0 ? "text-up" : "text-down")}>{signedPct(value)}</span>
    </div>
  );
}

function DemoProgress({ t }: { t?: number }) {
  const end = Date.now() / 1000;
  const p = t ? Math.min(1, Math.max(0, (t - DEMO_FROM) / (end - DEMO_FROM))) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400"><span>Jan 2025</span><span>Today</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-700"><div className="h-full rounded-full bg-wire transition-all" style={{ width: p * 100 + "%" }} /></div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const c = tone && value !== "–" ? (tone > 0 ? "text-up" : "text-down") : "text-white";
  return <div className="rounded-lg bg-ink-850 p-3"><div className="text-xs text-slate-400">{label}</div><div className={"mt-0.5 text-lg font-bold num " + c}>{value}</div></div>;
}

/** Spoken summary when the agents haven't written today's digest yet. */
function reportText(acct: any, markets: MarketRow[]) {
  const brains = markets.map((m) => `${m.symbol} on ${BRAINS[REGIMES[m.regime].brain].label}`).join(", ");
  const d = acct.pnl_today;
  return `Vantrel report. Portfolio ${usd(acct.equity, 0)}, ${d >= 0 ? "up" : "down"} ${usd(Math.abs(d), 0)} today. ${acct.positions.length ? `${acct.positions.length} open positions.` : "Holding cash."} Brains: ${brains}.`;
}

/** Price that flashes green/red on each live tick. */
function LivePrice({ price, prev, small }: { price: number; prev?: number; small?: boolean }) {
  const dir = prev == null || price === prev ? "" : price > prev ? "text-up" : "text-down";
  return <span key={price} className={"rise num " + (small ? "text-xs font-medium " : "text-sm ") + (dir || "text-slate-400")}>{usd(price, price >= 1000 ? 0 : 2)}</span>;
}

/** "● Live · 4s ago" while ticks arrive; "Delayed" when they stop. */
function LiveBadge({ ts }: { ts?: number }) {
  if (!ts) return <span className="text-xs font-medium text-slate-400">waiting for live prices…</span>;
  const age = Math.max(0, Math.round(Date.now() / 1000 - ts));
  const fresh = age < 45;
  return (
    <span className={"inline-flex items-center gap-1.5 text-xs font-medium " + (fresh ? "text-up" : "text-wire")}>
      <span className={"h-1.5 w-1.5 rounded-full " + (fresh ? "motion-safe:animate-pulse bg-up" : "bg-wire")} />
      {fresh ? `Live · ${age}s ago` : `Delayed · ${age}s`}
    </span>
  );
}

