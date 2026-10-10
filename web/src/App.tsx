import { useEffect, useMemo, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { api, stream, setToken, PROFILES, REGIME_COLOR, usd, speak, setVoice } from "./api";
import { RegimeChart, Lines } from "./Charts";
import { AuditBadge, VerifyPanel } from "./Audit";
import { Icon, type IconName } from "./Icons";
import { platform, standalone, canInstall, onInstallable, install } from "./platform";

type Tab = "overview" | "activity" | "proof" | "connect";
const TABS: [Tab, string, IconName][] = [["overview", "Overview", "overview"], ["activity", "Activity", "activity"], ["proof", "Proof", "proof"], ["connect", "Connect", "connect"]];
const TITLES: Record<Tab, string> = { overview: "Overview", activity: "Why-log", proof: "Proof", connect: "Connect" };
const pct = (x: number, d = 0) => (x * 100).toFixed(d) + "%";
const signed = (n: number) => (n > 0 ? "+" : "") + usd(n);

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

function Brand() { return <div className="brand"><span className="mark"><Icon n="bolt" size={16} /></span>Tripwire</div>; }

function Landing({ auth0, login, dev }: { auth0: boolean; login: () => void; dev: (n: string) => void }) {
  const [n, setN] = useState("");
  return <div className="landing-wrap">
    <header className="landing-header">
      <Brand />
      <div className="header-actions">
        {auth0 ? <button className="btn ghost" onClick={login}>Sign In</button> : null}
        <a href="#demo" className="btn sm">Watch Demo</a>
      </div>
    </header>
    <main className="landing">
      <section className="hero">
        <div className="badge">New: Breakout Brain 2.0</div>
        <h1>Enterprise-Grade AI.<br />Cryptographic <span className="accent">Safety.</span></h1>
        <p className="sub">An autonomous trading engine that adapts to market regimes instantly. AI executes the strategy, while Rust enforces your unbreachable risk limits.</p>
        
        <div className="hero-cta">
          {auth0 ? <button className="btn primary lg block" onClick={login}>Deploy Tripwire</button>
            : <form onSubmit={e => { e.preventDefault(); n.trim() && dev(n.trim()); }} className="signin">
                <label htmlFor="nm" className="sr">Your name</label>
                <input id="nm" placeholder="Enter your name to start" autoComplete="given-name" value={n} onChange={e => setN(e.target.value)} />
                <button className="btn primary lg" disabled={!n.trim()}>Deploy</button></form>}
          <p className="fine"><Icon n="ok" size={14} /> Paper money only. SOC2 compliance pending.</p>
        </div>
      </section>

      <section className="trust-signals">
        <p className="label">SECURED BY</p>
        <div className="logos">
          <span>Solana</span><span>Auth0</span><span>Vultr</span><span>Anthropic</span>
        </div>
      </section>

      <section className="features-grid">
        <div className="card">
          <Icon n="proof" size={24} className="accent" />
          <h3>Mathematical Guardrails</h3>
          <p>AI can tighten risk, but never loosen it. Rust layer enforces max position sizing.</p>
        </div>
        <div className="card">
          <Icon n="chain" size={24} className="accent" />
          <h3>Cryptographic Audit</h3>
          <p>Every single decision, reasoning log, and trade is permanently anchored to Solana.</p>
        </div>
        <div className="card">
          <Icon n="connect" size={24} className="accent" />
          <h3>Real-time Alerts</h3>
          <p>Stay updated with instant iMessage notifications and ElevenLabs voice alerts.</p>
        </div>
      </section>
    </main>
  </div>;
}

function Home({ logout }: { logout: () => void }) {
  const [acct, setAcct] = useState<any>(null), [missing, setMissing] = useState(false);
  const [tab, setTabState] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "overview");
  const setTab = (t: Tab) => { setTabState(t); history.replaceState(null, "", "#" + t); scrollTo({ top: 0 }); };
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
  const toggleVoice = () => { setVoice(!voice); setV(!voice); };
  if (missing) return <Onboard done={load} />;
  if (!acct) return <div className="loading" role="status"><span className="spinner" />Loading your portfolio…</div>;
  const startReplay = (dataset: string) => { setReplay([]); api("/v1/replays", "POST", { speed: dataset === "stocks" ? 60 : 40, dataset, from: dataset === "stocks" ? "2024-01-01" : "2025-01-01" }).catch(e => alert(e.message)); };
  return <div className="shell">
    <aside className="sidebar" aria-label="Main">
      <Brand />
      <nav className="side-nav">{TABS.map(([k, l, ic]) => <button key={k} className={"nav-item" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><Icon n={ic} />{l}</button>)}</nav>
      <div className="side-foot">
        <AuditBadge />
        {cfg.voice && <button className="nav-item" aria-pressed={voice} onClick={toggleVoice}><Icon n={voice ? "volume" : "mute"} />{voice ? "Voice alerts on" : "Voice alerts off"}</button>}
        <button className="nav-item" onClick={logout}><Icon n="logout" />Sign out</button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <h1>{TITLES[tab]}</h1>
        <StatusChip status={acct.status} />
      </header>
      {banner && <div className="banner" role="status"><Icon n="refresh" />{banner}</div>}
      {tab === "overview" && <Overview acct={acct} feed={feed} reasoning={reasoning} reload={load} voiceAvail={cfg.voice} seeAll={() => setTab("activity")} />}
      {tab === "activity" && <Activity feed={feed} />}
      {tab === "proof" && <Proof replay={replay} stocks={cfg.stocks} start={startReplay} />}
      {tab === "connect" && <Connect acct={acct} reload={load} cfg={cfg} voice={voice} toggleVoice={toggleVoice} logout={logout} />}
    </main>
    <nav className="tabbar" aria-label="Main">{TABS.map(([k, l, ic]) => <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><Icon n={ic} size={22} /><span>{l}</span></button>)}</nav>
  </div>;
}

const StatusChip = ({ status }: { status: string }) => <span className={"chip " + status}><i className="dot" />{status === "active" ? "Trading" : status === "paused" ? "Paused" : "Killed"}</span>;

function RiskPicker({ value, onChange }: { value: string; onChange: (p: string) => void }) {
  const keys = Object.keys(PROFILES);
  return <div className="segmented" role="radiogroup" aria-label="Risk profile">{keys.map(k =>
    <button key={k} role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>;
}

function Onboard({ done }: { done: () => void }) {
  const [p, setP] = useState("balanced"), [cash, setCash] = useState(10000), [goal, setGoal] = useState(1000), [months, setMonths] = useState(12), [busy, setBusy] = useState(false);
  const L = (PROFILES as any)[p];
  return <main className="onboard card">
    <Brand />
    <h2>Set it once. The AI handles the rest.</h2>
    <p className="muted">How much risk are you comfortable with?</p>
    <RiskPicker value={p} onChange={setP} />
    <dl className="limits">
      <div><dt>Risk per dip or breakout trade</dt><dd>{L.risk}</dd></div><div><dt>Max in one coin</dt><dd>{L.maxpos}</dd></div>
      <div><dt>Trend volatility target</dt><dd>{L.vol}</dd></div><div><dt>Auto-pause after a daily loss of</dt><dd>{L.loss}</dd></div>
    </dl>
    <p className="fine"><Icon n="proof" size={14} /> The AI can tighten these limits. It can never loosen them.</p>
    <div className="fields">
      <label>Paper funding ($)<input type="number" inputMode="numeric" min={100} value={cash} onChange={e => setCash(+e.target.value)} /></label>
      <label>Goal gain ($)<input type="number" inputMode="numeric" min={1} value={goal} onChange={e => setGoal(+e.target.value)} /></label>
      <label>In months<input type="number" inputMode="numeric" min={1} value={months} onChange={e => setMonths(+e.target.value)} /></label>
    </div>
    <button className="btn primary lg block" disabled={busy} onClick={() => { setBusy(true); api("/v1/accounts", "POST", { profile: p, start_cash: cash, goal_amount: goal, goal_months: months }).then(done).finally(() => setBusy(false)); }}>{busy ? "Funding…" : "Fund & start"}</button>
  </main>;
}

function Overview({ acct, feed, reasoning, reload, voiceAvail, seeAll }: any) {
  const [regimes, setRegimes] = useState<any[]>([]), [sym, setSym] = useState("BTC"), [candles, setCandles] = useState<any[]>([]), [busy, setBusy] = useState("");
  useEffect(() => { const f = () => api("/v1/market/regimes").then(setRegimes); f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, []);
  useEffect(() => { api(`/v1/market/${sym}/candles?days=365`).then(setCandles); }, [sym]);
  const act = (x: string) => { setBusy(x); return api(`/v1/accounts/me/${x}`, "POST").then(reload).finally(() => setBusy("")); };
  const confirmAct = (x: string, q: string) => confirm(q) && act(x);
  const s = acct.stats;
  return <div className="stack">
    <section className="hero card">
      <div className="hero-main">
        <span className="label">Portfolio value</span>
        <b className="big num">{usd(acct.equity)}</b>
        <div className="deltas"><span className={"num " + (acct.pnl_today >= 0 ? "up" : "down")}>{signed(acct.pnl_today)} today</span><span className={"num " + (acct.pnl_total >= 0 ? "up" : "down")}>{signed(acct.pnl_total)} total</span></div>
      </div>
      <div className="hero-side">
        <div><span className="label">Goal · {usd(acct.goal.amount)} in {acct.goal.months} mo</span>
          <div className="bar" role="progressbar" aria-valuenow={Math.round(acct.goal.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: Math.min(100, acct.goal.progress * 100) + "%" }} /></div>
          <small className="muted">{pct(acct.goal.progress, 1)} of the way</small></div>
        <div><span className="label">Win rate vs break-even</span><b className="num">{pct(s.win_rate)} <span className="muted">/ {pct(s.breakeven_win_rate)}</span></b><small className="muted">{s.trades} closed trades</small></div>
      </div>
    </section>

    <section className="card safety">
      <div className="safety-risk">
        <span className="label">Risk profile</span>
        <RiskPicker value={acct.profile} onChange={(p) => api("/v1/accounts/me/profile", "PATCH", { profile: p }).then(reload).catch(e => alert(e.message))} />
        <small className="muted">Risk {pct(acct.limits.risk)} per trade · max {pct(acct.limits.maxpos)} in one coin · daily stop {pct(acct.limits.daily_loss)}</small>
      </div>
      <div className="safety-actions">
        {acct.status === "active"
          ? <button className="btn" disabled={!!busy} onClick={() => act("pause")}><Icon n="pause" />Pause</button>
          : <button className="btn" disabled={!!busy} onClick={() => act("resume")}><Icon n="play" />Resume</button>}
        <button className="btn" disabled={!!busy} onClick={() => confirmAct("flatten", "Sell every position now at market?")}><Icon n="sell" />Sell everything</button>
        <button className="btn warn" disabled={!!busy} onClick={() => act("agent-loosen")} title="Demo: the AI asks to double its own risk. Rust refuses."><Icon n="shieldOff" />Let AI raise its risk</button>
        <button className="btn danger" disabled={!!busy} onClick={() => confirmAct("kill", "Turn on the kill switch? No new orders until you resume.")}><Icon n="power" />Kill switch</button>
        <TextMe linked={!!acct.imessage} reload={reload} />
      </div>
    </section>

    <section aria-label="Markets" className="regimes">{regimes.map(r => <button key={r.symbol} className={"card regime" + (sym === r.symbol ? " sel" : "")} aria-pressed={sym === r.symbol} onClick={() => setSym(r.symbol)} style={{ ["--rc" as any]: REGIME_COLOR[r.regime] }}>
      <div className="row between"><b>{r.symbol}</b><span className="num">{usd(r.price)}</span></div>
      <div className="brain"><i className="dot" />{r.brain_label} brain</div>
      <small className="muted">{r.regime_label} · {r.source === "ai" ? `AI ${pct(r.confidence)} confident` : r.source === "override_rejected" ? "AI overruled by Rust" : "rule-based"}</small>
      {r.ai_reason && <p className="fine">{r.ai_reason}</p>}
      {reasoning[r.symbol] && <p className="think">{reasoning[r.symbol]}</p>}
    </button>)}</section>

    <section className="card"><div className="card-head"><h3>{sym} · daily, shaded by market regime</h3><Legend /></div><RegimeChart data={candles} /></section>

    <div className="cols">
      <section className="card"><h3>Positions</h3>
        {acct.positions.length ? <div className="table-wrap"><table><thead><tr><th>Coin</th><th>Brain</th><th className="r">Value</th><th className="r">P&L</th><th className="r">Stop</th></tr></thead><tbody>
          {acct.positions.map((p: any) => <tr key={p.symbol} title={p.thesis?.reason}><td><b>{p.symbol}</b></td><td>{p.brain_label}</td><td className="r num">{usd(p.value)}</td><td className={"r num " + (p.pnl >= 0 ? "up" : "down")}>{signed(p.pnl)}</td><td className="r num">{usd(p.stop)}</td></tr>)}
        </tbody></table></div> : <div className="empty"><Icon n="proof" size={22} /><p>No positions. The AI is waiting for its setup, or holding cash on purpose.</p></div>}
        {acct.digest && <div className="digest"><Icon n="note" /><p>{acct.digest}</p>{voiceAvail && <button className="btn ghost sm" onClick={() => speak(acct.digest, true)}><Icon n="volume" size={16} />Listen</button>}</div>}
      </section>
      <section className="card"><div className="card-head"><h3>Latest decisions</h3><button className="btn ghost sm" onClick={seeAll}>See all<Icon n="chevron" size={16} /></button></div>
        <EventList items={feed.filter((e: any) => !e.kind.startsWith("replay")).slice(0, 6)} /></section>
    </div>
  </div>;
}

const FILTERS: [string, string, (k: string) => boolean][] = [["all", "All", () => true], ["trades", "Trades", k => k === "order" || k === "mirror"], ["blocked", "Blocked", k => k === "gate_block" || k === "auto_pause" || k === "kill"], ["ai", "AI", k => ["thesis", "ai_regime", "regime", "digest", "limits"].includes(k)], ["chain", "On-chain", k => k === "anchor"]];
function Activity({ feed }: { feed: any[] }) {
  const [f, setF] = useState("all"); const fn = FILTERS.find(x => x[0] === f)![2];
  const items = feed.filter((e: any) => !e.kind.startsWith("replay") && fn(e.kind));
  return <div className="stack">
    <div className="filters" role="tablist" aria-label="Filter">{FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={f === k} className={"pill" + (f === k ? " on" : "")} onClick={() => setF(k)}>{l}</button>)}</div>
    <section className="card">{items.length ? <EventList items={items} /> : <div className="empty"><Icon n="activity" size={22} /><p>Nothing here yet. Every trade, AI decision and blocked order shows up with a plain-English reason.</p></div>}</section>
  </div>;
}
const KIND_ICON: Record<string, IconName> = { order: "trade", gate_block: "shieldOff", auto_pause: "pause", kill: "power", regime: "refresh", ai_regime: "bolt", thesis: "bolt", digest: "note", anchor: "chain", mirror: "external", limits: "proof", status: "ok" };
function EventList({ items }: { items: any[] }) {
  return <ol className="events">{items.map((e: any) => <li key={e.id + e.kind + e.ts} className={"ev k-" + e.kind}>
    <span className="ev-ico"><Icon n={KIND_ICON[e.kind] ?? "activity"} size={16} /></span>
    <div className="ev-body"><p>{e.msg}</p>
      <div className="ev-meta"><time dateTime={new Date(e.ts * 1000).toISOString()}>{new Date(e.ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
        {e.kind === "gate_block" && <code>{e.data?.code}{e.data?.latency_ns != null ? ` · ${(e.data.latency_ns / 1000).toFixed(2)}µs` : ""}</code>}</div></div>
  </li>)}</ol>;
}

function Proof({ replay, start, stocks }: { replay: any[]; start: (d: string) => void; stocks: boolean }) {
  const [bt, setBt] = useState<any>(null);
  useEffect(() => { api("/v1/backtest").then(setBt).catch(() => {}); }, []);
  const last = replay[replay.length - 1];
  const pctSeries = (k: string) => replay.map(r => [r.t, (r[k] / 10000 - 1) * 100] as [number, number]);
  return <div className="stack">
    <VerifyPanel />
    <section className="card"><div className="card-head"><h3>Replay: watch it trade real history</h3>
      <div className="row"><button className="btn primary" onClick={() => start("crypto")}><Icon n="play" size={16} />Crypto 2025 → today</button>{stocks && <button className="btn" onClick={() => start("stocks")}><Icon n="play" size={16} />Stocks 2024 → today</button>}</div></div>
      {last && <div className="replay-score"><div><span className="label">Tripwire</span><b className={"num " + (last.equity >= 10000 ? "up" : "down")}>{((last.equity / 10000 - 1) * 100).toFixed(1)}%</b></div><div><span className="label">Buy & hold</span><b className={"num " + (last.buy_hold >= 10000 ? "up" : "down")}>{((last.buy_hold / 10000 - 1) * 100).toFixed(1)}%</b></div><small className="muted">{new Date(last.t * 1000).toLocaleDateString()}</small></div>}
      <Lines pct series={[{ name: "Tripwire", color: "#22c55e", points: pctSeries("equity") }, { name: "buy & hold", color: "#94a3b8", points: pctSeries("buy_hold") }]} />
      <p className="fine">Same Rust engine as live, fed real daily prices, 0.25% fee + 0.05% slippage per side.</p></section>
    {bt && <section className="card"><h3>Backtest 2022 → 2026 (fees included)</h3>
      <div className="stats">
        <Stat label="2025–26 market" value={bt.headline.oos_market + "%"} tone={-1} /><Stat label="Tripwire 2025–26" value={`+${bt.headline.oos_conservative}% to +${bt.headline.oos_aggressive}%`} tone={1} />
        <Stat label="Worst drop · Tripwire" value={bt.headline.maxdd_conservative + "%"} /><Stat label="Worst drop · buy & hold" value={bt.headline.maxdd_buy_hold + "%"} tone={-1} />
        <Stat label="Win rate / break-even" value={`${bt.headline.win_rate}% / ${bt.headline.breakeven_win_rate}%`} sub={`${bt.headline.trades} trades`} />
      </div>
      <Lines pct series={["buy_hold", "conservative", "balanced", "aggressive"].map((k, i) => ({ name: k.replace("_", " & "), color: ["#94a3b8", "#60a5fa", "#22c55e", "#f59e0b"][i], points: bt.curves[k].map(([t, v]: any) => [t, (v - 1) * 100]) }))} />
      <p className="fine">Honest caveats: 98 trades is a small sample. It trails buy & hold in strong bull runs; it's built to protect. Past results don't predict future returns.</p></section>}
  </div>;
}

function Connect({ acct, reload, cfg, voice, toggleVoice, logout }: any) {
  const mcp = useMemo(() => JSON.stringify({ mcpServers: { tripwire: { command: "python", args: ["mcp/server.py"], env: { TRIPWIRE_API: location.origin, TRIPWIRE_MCP_TOKEN: acct.mcp_token } } } }, null, 2), [acct.mcp_token]);
  const [copied, setCopied] = useState(false);
  return <div className="stack">
    <section className="card"><div className="card-head"><h3><Icon n="connect" />iMessage</h3>{acct.imessage && <span className="chip active"><i className="dot" />Linked</span>}</div>
      <p className="muted">Tripwire texts you when it trades, blocks an order or pauses. Text back <code>status</code>, ask "why did you sell SOL?", or send <code>pause</code>. A text can make it safer, never riskier.</p>
      <TextMe linked={!!acct.imessage} reload={reload} big /></section>
    <InstallCard />
    <section className="card"><h3><Icon n="bolt" />Claude Desktop (MCP)</h3>
      <p className="muted">Add this to Claude Desktop, then ask: <i>"How is my portfolio doing against my goal?"</i> Read-only: Claude can explain, never trade.</p>
      <div className="code"><pre>{mcp}</pre><button className="btn sm" onClick={() => navigator.clipboard.writeText(mcp).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</button></div></section>
    <section className="card settings">
      {cfg.voice && <button className="row-btn" aria-pressed={voice} onClick={toggleVoice}><Icon n={voice ? "volume" : "mute"} /><span>Voice alerts</span><span className="muted">{voice ? "On" : "Off"}</span></button>}
      <button className="row-btn danger-text" onClick={logout}><Icon n="logout" /><span>Sign out</span></button>
    </section>
  </div>;
}

function InstallCard() {
  const [can, setCan] = useState(canInstall()); useEffect(() => onInstallable(() => setCan(true)), []);
  if (standalone) return <section className="card"><h3><Icon n="download" />App installed</h3><p className="muted">You're using the Tripwire app.</p></section>;
  return <section className="card"><h3><Icon n="download" />Get the app</h3>
    <div className="platforms">
      <div className={"plat" + (platform === "ios" ? " here" : "")}><Icon n="phone" size={20} /><b>iPhone</b><p className="muted">In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>.</p></div>
      <div className={"plat" + (platform === "mac" ? " here" : "")}><Icon n="laptop" size={20} /><b>Mac</b><p className="muted">Safari: <b>File → Add to Dock</b>. Chrome: install icon in the address bar.</p></div>
      <div className={"plat" + (platform === "windows" ? " here" : "")}><Icon n="laptop" size={20} /><b>Windows</b><p className="muted">Edge or Chrome: <b>Install Tripwire</b> from the address bar or the button below.</p></div>
    </div>
    {can && <button className="btn primary" onClick={() => install().then(ok => ok && setCan(false))}><Icon n="download" size={16} />Install Tripwire</button>}
  </section>;
}

const Stat = ({ label, value, sub, tone }: any) => <div className="stat"><span className="label">{label}</span><b className={"num " + (tone > 0 ? "up" : tone < 0 ? "down" : "")}>{value}</b>{sub && <small className="muted">{sub}</small>}</div>;
const Legend = () => <div className="legend">{Object.entries({ RANGE: "Calm · Mean-Reversion", TREND_UP: "Trending · Trend", HIGH_VOL: "Volatile · Breakout", TREND_DOWN: "Falling · Shield" }).map(([k, v]) => <span key={k}><i style={{ background: REGIME_COLOR[k] }} />{v}</span>)}</div>;

// iMessage (Photon Spectrum): get a 4-digit code, text "link 1234" to the Tripwire number.
function TextMe({ linked, reload, big }: { linked: boolean; reload: () => void; big?: boolean }) {
  const [code, setCode] = useState<string | null>(null), [num, setNum] = useState("");
  useEffect(() => { api("/v1/config").then((c: any) => setNum(c.imessage_number || "")).catch(() => {}); }, []);
  if (linked) return big ? <button className="btn" onClick={() => api("/v1/accounts/me/unlink-phone", "POST").then(reload)}>Stop texts</button> : null;
  if (code) return <div className="textme"><span>Text</span><code>link {code}</code>{num ? <><span>to</span><b>{num}</b></> : null}<small className="muted">within 10 min</small></div>;
  return <button className={"btn" + (big ? " primary" : "")} onClick={() => api("/v1/accounts/me/link-code", "POST").then((r: any) => setCode(r.code))}><Icon n="connect" size={16} />Text me</button>;
}
