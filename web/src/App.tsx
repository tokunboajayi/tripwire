import { useEffect, useMemo, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { api, stream, setToken, getToken, PROFILES, REGIME_COLOR, usd, speak, setVoice } from "./api";
import { RegimeChart, Lines } from "./Charts";

export default function App({ auth0 }: { auth0: boolean }) {
  const a = auth0 ? useAuth0() : null;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (a?.isAuthenticated) a.getAccessTokenSilently().then(t => { setToken(t); setReady(true); });
    else if (!auth0) { const n = localStorage.getItem("tw_user"); if (n) { setToken("dev:" + n); setReady(true); } }
  }, [a?.isAuthenticated]);
  if (!ready) return <Landing auth0={auth0} login={() => a?.loginWithRedirect()} dev={(n) => { localStorage.setItem("tw_user", n); setToken("dev:" + n); setReady(true); }} />;
  return <Home logout={() => { localStorage.removeItem("tw_user"); a ? a.logout() : location.reload(); }} />;
}

function Landing({ auth0, login, dev }: { auth0: boolean; login: () => void; dev: (n: string) => void }) {
  const [n, setN] = useState("");
  return <div className="landing">
    <div className="brand">TRIPWIRE</div>
    <h1>Set your risk. AI trades.<br />Rust keeps it safe.</h1>
    <p className="sub">An AI investor that switches between three trading brains to fit the market, and a safety layer it can't override. Paper trading on live crypto prices.</p>
    {auth0 ? <button className="primary big" onClick={login}>Sign in to start</button>
      : <form onSubmit={e => { e.preventDefault(); n && dev(n); }} className="row"><input placeholder="Your name" value={n} onChange={e => setN(e.target.value)} /><button className="primary">Start</button></form>}
    <p className="fine">Paper money only. Not financial advice.</p>
  </div>;
}

function Home({ logout }: { logout: () => void }) {
  const [acct, setAcct] = useState<any>(null), [missing, setMissing] = useState(false), [tab, setTab] = useState("live");
  const [feed, setFeed] = useState<any[]>([]), [reasoning, setReasoning] = useState<Record<string, string>>({}), [banner, setBanner] = useState("");
  const [replay, setReplay] = useState<{ t: number; equity: number; buy_hold: number }[]>([]);
  const [cfg, setCfg] = useState<any>({}), [voice, setV] = useState(false);
  useEffect(() => { api("/v1/config").then(setCfg).catch(() => {}); }, []);
  const load = () => api("/v1/accounts/me").then(x => { setAcct(x); setMissing(false); }).catch(e => e.status === 404 && setMissing(true));
  useEffect(() => {
    load(); api("/v1/accounts/me/events").then(setFeed).catch(() => {});
    const t = setInterval(load, 15000);
    const close = stream((k, ev) => {
      if (k === "reasoning") return setReasoning(r => ({ ...r, [ev.data.symbol]: ((r[ev.data.symbol] || "") + ev.msg).slice(-900) }));
      if (k === "replay_tick") return setReplay(r => [...r, ev.data]);
      if (k === "regime") { setBanner(ev.msg); speak(ev.msg); setTimeout(() => setBanner(""), 9000); }
      if (k === "order" && ev.data?.reason?.startsWith?.("AI thesis")) speak(ev.msg);
      if (ev.msg) setFeed(f => [ev, ...f].slice(0, 200));
      if (["order", "status", "limits", "auto_pause", "kill", "digest"].includes(k)) load();
    });
    return () => { clearInterval(t); close(); };
  }, []);
  if (missing) return <Onboard done={load} />;
  if (!acct) return <div className="loading">Loading…</div>;
  return <div className="app">
    <header>
      <div className="brand">TRIPWIRE</div>
      <nav>{[["live", "Live"], ["proof", "Replay & Backtest"], ["connect", "Talk to Claude"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {cfg.voice && <button className={voice ? "on" : ""} onClick={() => { setVoice(!voice); setV(!voice); }}>{voice ? "🔊 Voice on" : "🔈 Voice alerts"}</button>}
      <button className="ghost" onClick={logout}>Sign out</button>
    </header>
    {banner && <div className="banner">⟳ {banner}</div>}
    {tab === "live" && <Live acct={acct} feed={feed} reasoning={reasoning} reload={load} />}
    {tab === "proof" && <Proof replay={replay} stocks={cfg.stocks} start={(dataset: string) => { setReplay([]); api("/v1/replays", "POST", { speed: dataset === "stocks" ? 60 : 40, dataset, from: dataset === "stocks" ? "2024-01-01" : "2025-01-01" }).catch(e => alert(e.message)); }} />}
    {tab === "connect" && <Connect token={acct.mcp_token} />}
  </div>;
}

function Onboard({ done }: { done: () => void }) {
  const keys = Object.keys(PROFILES) as (keyof typeof PROFILES)[];
  const [i, setI] = useState(1), [cash, setCash] = useState(10000), [goal, setGoal] = useState(1000), [months, setMonths] = useState(12);
  const p = keys[i], L = PROFILES[p];
  return <div className="card onboard">
    <h2>Set it once. AI handles the rest.</h2>
    <label>How much risk are you comfortable with? <b className="cap">{p}</b></label>
    <input type="range" min={0} max={2} value={i} onChange={e => setI(+e.target.value)} />
    <table className="limits"><tbody>
      <tr><td>Risk per dip/breakout trade</td><td>{L.risk}</td></tr><tr><td>Max in one coin</td><td>{L.maxpos}</td></tr>
      <tr><td>Trend position volatility target</td><td>{L.vol}</td></tr><tr><td>Auto-pause after a daily loss of</td><td>{L.loss}</td></tr>
    </tbody></table>
    <p className="fine">The AI can tighten these limits. It can never loosen them.</p>
    <div className="grid3">
      <label>Paper funding<input type="number" value={cash} onChange={e => setCash(+e.target.value)} /></label>
      <label>Goal (gain $)<input type="number" value={goal} onChange={e => setGoal(+e.target.value)} /></label>
      <label>In months<input type="number" value={months} onChange={e => setMonths(+e.target.value)} /></label>
    </div>
    <button className="primary big" onClick={() => api("/v1/accounts", "POST", { profile: p, start_cash: cash, goal_amount: goal, goal_months: months }).then(done)}>Fund & start</button>
  </div>;
}

function Live({ acct, feed, reasoning, reload }: any) {
  const [regimes, setRegimes] = useState<any[]>([]), [sym, setSym] = useState("BTC"), [candles, setCandles] = useState<any[]>([]);
  useEffect(() => { const f = () => api("/v1/market/regimes").then(setRegimes); f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, []);
  useEffect(() => { api(`/v1/market/${sym}/candles?days=365`).then(setCandles); }, [sym]);
  const act = (x: string) => api(`/v1/accounts/me/${x}`, "POST").then(reload);
  const profiles = Object.keys(PROFILES);
  const s = acct.stats;
  return <div className="live">
    <section className="kpis">
      <Kpi label="Portfolio" value={usd(acct.equity)} sub={`started ${usd(acct.start_cash)}`} />
      <Kpi label="Today" value={usd(acct.pnl_today)} tone={acct.pnl_today} />
      <Kpi label="Total" value={usd(acct.pnl_total)} tone={acct.pnl_total} />
      <div className="kpi"><span>Goal: {usd(acct.goal.amount)} in {acct.goal.months} mo</span><div className="bar"><i style={{ width: Math.min(100, acct.goal.progress * 100) + "%" }} /></div><small>{(acct.goal.progress * 100).toFixed(1)}% of the way</small></div>
      <div className="kpi"><span>Win rate vs break-even</span><b>{(s.win_rate * 100).toFixed(0)}% / {(s.breakeven_win_rate * 100).toFixed(0)}%</b><small>{s.trades} closed trades</small></div>
    </section>
    <section className="controls card">
      <div><label>Risk <b className="cap">{acct.profile}</b></label>
        <input type="range" min={0} max={2} value={profiles.indexOf(acct.profile)} onChange={e => api("/v1/accounts/me/profile", "PATCH", { profile: profiles[+e.target.value] }).then(reload)} />
        <small>risk {(acct.limits.risk * 100).toFixed(0)}% · max coin {(acct.limits.maxpos * 100).toFixed(0)}% · daily stop {(acct.limits.daily_loss * 100).toFixed(0)}%</small></div>
      <span className={"chip " + acct.status}>{acct.status}</span>
      {acct.status === "active" ? <button onClick={() => act("pause")}>Pause</button> : <button onClick={() => act("resume")}>Resume</button>}
      <button onClick={() => act("flatten")}>Sell everything</button>
      <button className="warn" onClick={() => act("agent-loosen")}>Let AI raise its own risk</button>
      <button className="danger" onClick={() => act("kill")}>Kill switch</button>
    </section>
    <section className="regimes">{regimes.map(r => <div key={r.symbol} className={"card regime" + (sym === r.symbol ? " sel" : "")} onClick={() => setSym(r.symbol)} style={{ borderTopColor: REGIME_COLOR[r.regime] }}>
      <div className="row between"><b>{r.symbol}</b><span>{usd(r.price)}</span></div>
      <div className="brain" style={{ color: REGIME_COLOR[r.regime] }}>{r.brain_label} brain</div>
      <small>{r.regime_label} · {r.source === "ai" ? `AI ${(r.confidence * 100).toFixed(0)}% confident` : r.source === "override_rejected" ? "AI overruled by Rust" : "rule-based"}</small>
      {r.ai_reason && <p className="fine">{r.ai_reason}</p>}
      {reasoning[r.symbol] && <p className="think">{reasoning[r.symbol]}</p>}
    </div>)}</section>
    <section className="card"><div className="row between"><h3>{sym} · daily, shaded by market regime</h3><Legend /></div><RegimeChart data={candles} /></section>
    <div className="cols">
      <section className="card"><h3>Positions</h3>
        {acct.positions.length ? <table><thead><tr><th>Coin</th><th>Brain</th><th>Value</th><th>P&L</th><th>Stop</th></tr></thead><tbody>
          {acct.positions.map((p: any) => <tr key={p.symbol} title={p.thesis?.reason}><td>{p.symbol}</td><td>{p.brain_label}</td><td>{usd(p.value)}</td><td className={p.pnl >= 0 ? "up" : "down"}>{usd(p.pnl)}</td><td>{usd(p.stop)}</td></tr>)}
        </tbody></table> : <p className="fine">No positions. The AI is waiting for its setup, or holding cash on purpose.</p>}
        {acct.digest && <p className="digest">📝 {acct.digest}</p>}
      </section>
      <section className="card feed"><h3>Why-log</h3>{feed.filter((e: any) => !e.kind.startsWith("replay")).map((e: any) =>
        <div key={e.id + e.kind + e.ts} className={"ev " + e.kind}><time>{new Date(e.ts * 1000).toLocaleTimeString()}</time>
          {e.kind === "gate_block" && <code>{e.data?.code}{e.data?.latency_ns != null ? ` · ${(e.data.latency_ns / 1000).toFixed(2)}µs` : ""}</code>}<span>{e.msg}</span></div>)}</section>
    </div>
  </div>;
}

function Proof({ replay, start, stocks }: { replay: any[]; start: (d: string) => void; stocks: boolean }) {
  const [bt, setBt] = useState<any>(null);
  useEffect(() => { api("/v1/backtest").then(setBt).catch(() => {}); }, []);
  const last = replay[replay.length - 1];
  const pctSeries = (k: string) => replay.map(r => [r.t, (r[k] / 10000 - 1) * 100] as [number, number]);
  return <div className="proof">
    <section className="card"><div className="row between"><h3>Replay: watch it trade real history, day by day</h3><div className="row"><button className="primary" onClick={() => start("crypto")}>▶ Crypto 2025 → today</button>{stocks && <button onClick={() => start("stocks")}>▶ Stocks 2024 → today</button>}</div></div>
      {last && <p><b>Tripwire {((last.equity / 10000 - 1) * 100).toFixed(1)}%</b> vs buy & hold {((last.buy_hold / 10000 - 1) * 100).toFixed(1)}% · {new Date(last.t * 1000).toLocaleDateString()}</p>}
      <Lines pct series={[{ name: "Tripwire", color: "#2bb673", points: pctSeries("equity") }, { name: "buy & hold", color: "#9aa0a6", points: pctSeries("buy_hold") }]} />
      <p className="fine">Same Rust engine as live, fed real daily prices, 0.25% fee + 0.05% slippage per side. Stocks: AAPL, MSFT, NVDA, AMZN, SPY.</p></section>
    {bt && <section className="card"><h3>Backtest 2022 → 2026 (v2, fees included)</h3>
      <div className="kpis">
        <Kpi label="2025–26 market" value={bt.headline.oos_market + "%"} tone={-1} /><Kpi label="Tripwire 2025–26" value={`+${bt.headline.oos_conservative}% to +${bt.headline.oos_aggressive}%`} tone={1} />
        <Kpi label="Worst drop: Tripwire" value={bt.headline.maxdd_conservative + "%"} /><Kpi label="Worst drop: buy & hold" value={bt.headline.maxdd_buy_hold + "%"} tone={-1} />
        <Kpi label="Win rate / break-even" value={`${bt.headline.win_rate}% / ${bt.headline.breakeven_win_rate}%`} sub={`${bt.headline.trades} trades`} />
      </div>
      <Lines pct series={["buy_hold", "conservative", "balanced", "aggressive"].map((k, i) => ({ name: k.replace("_", " & "), color: ["#9aa0a6", "#4c8bf5", "#2bb673", "#f29d38"][i], points: bt.curves[k].map(([t, v]: any) => [t, (v - 1) * 100]) }))} />
      <p className="fine">Honest caveats: 98 trades is a small sample. It trails buy & hold in strong bull runs; it's built to protect. Past results don't predict future returns.</p></section>}
  </div>;
}

function Connect({ token }: { token: string }) {
  const cfg = useMemo(() => JSON.stringify({ mcpServers: { tripwire: { command: "python", args: ["mcp/server.py"], env: { TRIPWIRE_API: location.origin, TRIPWIRE_MCP_TOKEN: token } } } }, null, 2), [token]);
  return <section className="card"><h3>Talk to your portfolio from Claude</h3>
    <p>Add Tripwire as an MCP server in Claude Desktop, then ask: <i>"Why did my AI sell ETH?"</i> or <i>"How is my portfolio doing against my goal?"</i></p>
    <p className="fine">Read-only: Claude can explain, never trade.</p><pre>{cfg}</pre></section>;
}

const Kpi = ({ label, value, sub, tone }: any) => <div className="kpi"><span>{label}</span><b className={tone > 0 ? "up" : tone < 0 ? "down" : ""}>{value}</b>{sub && <small>{sub}</small>}</div>;
const Legend = () => <div className="legend">{Object.entries({ RANGE: "Calm → Mean-Reversion", TREND_UP: "Trending → Trend", HIGH_VOL: "Volatile → Breakout", TREND_DOWN: "Falling → Shield" }).map(([k, v]) => <span key={k}><i style={{ background: REGIME_COLOR[k] }} />{v}</span>)}</div>;
