import { useEffect, useState } from "react";
import { api, BRAINS, REGIMES, type Regime } from "../lib/api";
import { navigate } from "../lib/router";
import { Logo, Mark } from "../components/Logo";
import { Icon } from "../components/Icons";

/** `/` — the pitch in one scroll, then sign in. */
export default function Landing({ auth0, signin = "name", login, devLogin }: { auth0: boolean; signin?: string; login: () => void; devLogin: (name: string) => void }) {
  const [name, setName] = useState("");
  const [bt, setBt] = useState<any>(null);
  useEffect(() => { api("/v1/backtest").then(setBt).catch(() => {}); }, []);
  const h = bt?.headline;

  const start = (big?: boolean) => signin === "unreachable" ? (
    <p role="status" className="max-w-md rounded-md border border-ink-700 bg-ink-900 p-3 text-sm text-slate-300">Can't reach the server right now. Retrying every 5 seconds…</p>
  ) : signin === "outdated" ? (
    <p role="alert" className="max-w-md rounded-md border border-wire/40 bg-wire/10 p-3 text-sm text-amber-100">This page is newer than the server's engine, so sign-in would fail. Redeploy with <code>--build</code> so both update together.</p>
  ) : signin === "none" ? (
    <p role="alert" className="max-w-md rounded-md border border-wire/40 bg-wire/10 p-3 text-sm text-amber-100">Sign-in is turned off on this server. Set GUEST_SIGNIN=1 (or configure Auth0) and restart the engine.</p>
  ) : auth0 ? (
    <button className={"btn btn-primary " + (big ? "px-6 py-3.5 text-base" : "")} onClick={login}>Get started <Icon n="chevron" size={18} /></button>
  ) : (
    <form className="flex w-full max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); name.trim() && devLogin(name.trim()); }}>
      <label htmlFor={big ? "nm1" : "nm2"} className="sr-only">Your name</label>
      <input id={big ? "nm1" : "nm2"} className="input py-3 text-base" placeholder="Your first name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn btn-primary shrink-0 px-5" disabled={!name.trim()}>Get started</button>
    </form>
  );

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <button className="btn btn-ghost" onClick={() => navigate("/backtest")}>Results</button>
          {auth0 && <button className="btn" onClick={login}>Sign in</button>}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* hero */}
        <section className="grid items-center gap-10 py-12 lg:grid-cols-[1.15fr_1fr] lg:py-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1 text-xs font-semibold text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-wire" /> Paper trading on live crypto prices
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">
              Set your risk.<br />Fund it.<br /><span className="text-wire">AI trades for you.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-400">
              Vantrel switches between three trading brains to fit the market, explains every move in plain English,
              and runs behind a <span className="font-semibold text-wire">Rust safety layer the AI can't override</span>.
            </p>
            <div className="mt-8">{start(true)}</div>
            <p className="mt-3 text-xs text-slate-400">Takes 60 seconds. Paper money only. Not financial advice.</p>
          </div>
          <HeroCard />
        </section>

        {/* how it works */}
        <section className="py-10">
          <h2 className="text-2xl font-bold text-white">How it works</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              ["1", "Set it once", "Pick Conservative, Balanced or Aggressive. Set a goal. Fund a paper account."],
              ["2", "AI runs everything", "It reads the market, picks the right brain, sizes, enters, exits and manages stops."],
              ["3", "You watch", "Live chart, positions, today's gain or loss, goal progress, and a one-line why for every action."],
            ].map(([n, t, d]) => (
              <div key={n} className="card p-6">
                <span className="grid h-8 w-8 place-items-center rounded-md border border-wire/40 bg-wire/10 font-mono text-sm font-bold text-wire">{n}</span>
                <h3 className="mt-4 font-semibold text-white">{t}</h3>
                <p className="mt-1 text-sm text-slate-400">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* brains */}
        <section className="py-10">
          <h2 className="text-2xl font-bold text-white">Three brains and a shield</h2>
          <p className="mt-2 max-w-2xl text-slate-400">Every human trader is stuck with one strategy. Vantrel reads the market regime and switches brains in real time.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(REGIMES) as Regime[]).map((r) => {
              const g = REGIMES[r], b = BRAINS[g.brain];
              return (
                <div key={r} className="card p-6" style={{ borderTopColor: g.color, borderTopWidth: 3 }}>
                  <div className="label" style={{ color: g.color }}>When the market is {g.label.toLowerCase()}</div>
                  <h3 className="mt-3 text-lg font-bold text-white">{b.label}</h3>
                  <p className="mt-1 text-sm text-slate-400">{b.does}.</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* safety */}
        <section className="py-10">
          <div className="card grid gap-8 p-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold text-white">AI chooses. Rust verifies.</h2>
              <p className="mt-3 text-slate-400">The AI picks the brain and explains why. Every order still goes through a risk gate written in Rust: your limits, checked in microseconds, every time.</p>
              <ul className="mt-5 space-y-3 text-sm">
                {["The AI can tighten your limits. It can never loosen them.", "If the AI is slow, wrong, or contradicts the data, Rust falls back to its own rules. Trading never freezes.",
                  "Daily loss limit auto-pauses the account. Kill switch stops every new order."].map((t) => (
                  <li key={t} className="flex gap-3 text-slate-300"><Icon n="check" size={18} className="mt-0.5 text-wire" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-down/30 bg-down/5 p-5 font-mono text-sm">
              <div className="text-slate-400">// AI agent, after a losing trade:</div>
              <div className="mt-1 text-slate-300">set_limits(risk: <span className="text-wire">2% → 4%</span>)</div>
              <div className="mt-4 text-slate-400">// Rust risk gate:</div>
              <div className="mt-1 font-bold text-red-300">LIMIT_LOOSEN_DENIED · 3.0µs</div>
              <div className="mt-4 text-slate-400">Agents can tighten limits, never loosen them.</div>
            </div>
          </div>
        </section>

        {/* proof */}
        <section className="py-10">
          <h2 className="text-2xl font-bold text-white">Tested on real history, fees included</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="card p-6"><div className="label">Crypto market 2025–26</div><div className="mt-2 text-3xl font-bold text-down num">{h ? h.oos_market + "%" : "−27.5%"}</div></div>
            <div className="card p-6"><div className="label">Vantrel 2025–26</div><div className="mt-2 text-3xl font-bold text-up num">{h ? `+${h.oos_conservative}% to +${h.oos_aggressive}%` : "+0.4% to +1.5%"}</div></div>
            <div className="card p-6"><div className="label">Worst drop 2022–26</div><div className="mt-2 text-3xl font-bold text-white num">{h ? `${h.maxdd_conservative}%` : "−17.4%"} <span className="text-base font-medium text-slate-400">vs {h ? h.maxdd_buy_hold : -75.8}% buy & hold</span></div></div>
          </div>
          <p className="mt-3 text-sm text-slate-400">Small sample ({h?.trades ?? 98} trades). It trails buy & hold in strong bull runs; it's built to protect. <button className="text-sky-300 underline" onClick={() => navigate("/backtest")}>See the full backtest</button>.</p>
        </section>

        {/* vs */}
        <section className="py-10">
          <h2 className="text-2xl font-bold text-white">Why not just…</h2>
          <div className="card mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-slate-400"><tr className="border-b border-ink-700">{["", "Who decides", "Adapts to the market", "Hard risk limits", "Explains itself"].map((x) => <th key={x} className="p-4 font-medium">{x}</th>)}</tr></thead>
              <tbody className="divide-y divide-ink-700">
                {[["Robinhood", "You (and your panic)", "Only if you do", "No", "No"], ["Acorns / robo-advisors", "A fixed index mix", "No", "n/a", "No"], ["Trading bots", "One fixed rule", "No", "Rarely", "No"]].map((r) => (
                  <tr key={r[0]}>{r.map((c, i) => <td key={i} className={"p-4 " + (i ? "text-slate-400" : "font-medium text-slate-200")}>{c}</td>)}</tr>
                ))}
                <tr className="bg-wire/5">{["Vantrel", "AI, per market regime", "Yes: 3 brains + shield", "Yes, in Rust", "Every action"].map((c, i) => <td key={i} className={"p-4 font-semibold " + (i ? "text-wire" : "text-white")}>{c}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col items-center gap-5 py-16 text-center">
          <Mark size={48} />
          <h2 className="text-3xl font-bold text-white">Set it once. Watch it work.</h2>
          {start()}
        </section>
      </main>
      <footer className="border-t border-ink-800 py-8 text-center text-xs text-slate-400">Paper trading only. Not financial advice. Past results don't predict future returns.</footer>
    </div>
  );
}

/** Static preview of what the dashboard tells you. */
function HeroCard() {
  return (
    <div className="card relative overflow-hidden p-6">
      <div className="flex items-center justify-between">
        <div><div className="label">Example portfolio</div><div className="mt-1 text-3xl font-bold text-white num">$10,482.16</div></div>
        <span className="rounded-full bg-up/10 px-2.5 py-1 text-sm font-semibold text-up num">+$61.40 today</span>
      </div>
      <svg viewBox="0 0 300 90" className="mt-5 w-full" aria-hidden>
        <rect x="0" y="0" width="110" height="90" fill="#60A5FA" opacity=".1" />
        <rect x="110" y="0" width="90" height="90" fill="#F5B841" opacity=".1" />
        <rect x="200" y="0" width="100" height="90" fill="#34D399" opacity=".1" />
        <line x1="0" y1="14" x2="300" y2="14" stroke="#F5B841" strokeDasharray="4 4" strokeOpacity=".6" />
        <polyline points="0,70 30,62 55,68 80,55 110,60 135,40 160,48 200,30 230,34 260,24 300,20" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex gap-2 rounded-lg bg-sky-400/10 p-2.5 text-sky-200"><Icon n="refresh" size={16} className="mt-0.5" />ETH: Calm → Volatile. Switching to the Breakout brain.</div>
        <div className="flex gap-2 rounded-lg bg-up/10 p-2.5 text-emerald-200"><Icon n="trade" size={16} className="mt-0.5" />Bought ETH: confirmed breakout on 2.1x normal volume. Stop −3.1%.</div>
        <div className="flex gap-2 rounded-lg bg-down/10 p-2.5 text-red-200"><Icon n="shieldOff" size={16} className="mt-0.5" />Blocked SOL buy: EXPOSURE_CAP · 2.4µs</div>
      </div>
    </div>
  );
}
