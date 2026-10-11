import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { api, setToken, setVoice, speak, stream, type Ev, type Live } from "./lib/api";
import { navigate, usePath, type Route } from "./lib/router";
import { Logo } from "./components/Logo";
import { Icon, type IconName } from "./components/Icons";
import { StatusPill } from "./components/ui";
import Landing from "./pages/Landing";
import Onboard from "./pages/Onboard";
import Dashboard from "./pages/Dashboard";
import Replay, { startReplay, stopReplay, type Demo, type ReplayTick } from "./pages/Replay";
import Backtest from "./pages/Backtest";
import Settings from "./pages/Settings";

const NAV: [Route, string, IconName][] = [["/app", "Dashboard", "overview"], ["/replay", "Replay", "play"], ["/backtest", "Backtest", "chart"], ["/settings", "Settings", "settings"]];

export default function App({ auth0 }: { auth0: boolean }) {
  const a = auth0 ? useAuth0() : null;
  const path = usePath();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (a?.isAuthenticated) a.getAccessTokenSilently().then((t) => { setToken(t); setSignedIn(true); });
    else if (!auth0) {
      const n = localStorage.getItem("vt_user");
      if (n) { setToken("dev:" + n); setSignedIn(true); }
    }
  }, [a?.isAuthenticated]);

  const logout = () => { localStorage.removeItem("vt_user"); setToken(""); setSignedIn(false); navigate("/", true); a?.logout({ logoutParams: { returnTo: location.origin } }); };

  if (!signedIn) {
    if (path === "/backtest") return <PublicShell><Backtest /></PublicShell>;
    if (path !== "/") navigate("/", true);
    if (a?.isLoading) return <Splash />;
    return <Landing auth0={auth0} login={() => a?.loginWithRedirect()} devLogin={(n) => { localStorage.setItem("vt_user", n); setToken("dev:" + n); setSignedIn(true); }} />;
  }
  return <SignedIn path={path} logout={logout} />;
}

function SignedIn({ path, logout }: { path: Route; logout: () => void }) {
  const [acct, setAcct] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [cfg, setCfg] = useState<any>({});
  const [feed, setFeed] = useState<Ev[]>([]);
  const [reasoning, setReasoning] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [ticks, setTicks] = useState<ReplayTick[]>([]);
  const [replayEvents, setReplayEvents] = useState<Ev[]>([]);
  const [replayRunning, setReplayRunning] = useState(false);
  const replayGen = useRef(0); // current replay run; events from older runs are ignored
  const [voice, setV] = useState(false);
  const [live, setLive] = useState<Live>({});

  const load = useCallback(() => api("/v1/accounts/me").then((x) => { setAcct(x); setMissing(false); }).catch((e) => e.status === 404 && setMissing(true)), []);

  useEffect(() => { load(); api("/v1/config").then(setCfg).catch(() => {}); }, []);

  // routing rules: no account → onboarding; account → never back to onboarding
  useEffect(() => {
    if (missing && path !== "/onboard") navigate("/onboard", true);
    if (acct && (path === "/" || path === "/onboard")) navigate("/app", true);
  }, [missing, acct, path]);

  // live updates
  useEffect(() => {
    if (!acct) return;
    api<Ev[]>("/v1/accounts/me/events?limit=200").then(setFeed).catch(() => {});
    const poll = setInterval(load, 10000); // portfolio value follows live prices
    const close = stream((k, ev) => {
      if (k === "tick") {
        const d = ev.data;
        setLive((l) => ({ ...l, [d.symbol]: { price: d.price, prev: l[d.symbol]?.price ?? d.price, bar: d.bar, ts: ev.ts } }));
        return;
      }
      if (k === "reasoning") return setReasoning((r) => ({ ...r, [ev.data.symbol]: ((r[ev.data.symbol] || "") + ev.msg).slice(-1200) }));
      if (k.startsWith("replay_") && ev.data?.gen != null && ev.data.gen !== replayGen.current) return; // stale run
      if (k === "replay_tick") return setTicks((t) => [...t, ev.data]);
      if (k === "replay_order" || k === "replay_regime") return setReplayEvents((e) => [ev, ...e].slice(0, 400));
      if (k === "replay_done") return setReplayRunning(false);
      if (k === "regime") { setBanner(ev.msg); speak(ev.msg); setTimeout(() => setBanner(""), 10000); }
      if (k === "order" && String(ev.data?.reason ?? "").startsWith("AI thesis")) speak(ev.msg);
      if (ev.msg) setFeed((f) => [ev, ...f].slice(0, 300));
      if (["order", "status", "limits", "auto_pause", "kill", "digest"].includes(k)) load();
    });
    return () => { clearInterval(poll); close(); };
  }, [!!acct]);

  const toggleVoice = () => { setVoice(!voice); setV(!voice); };
  const runReplay = async (dataset: string, speed?: number) => {
    replayGen.current = -1; // until the server names the new run, ignore every replay event
    setTicks([]); setReplayEvents([]); setReplayRunning(true);
    try {
      let r: any;
      try { r = await startReplay(dataset, speed); }
      catch (e: any) {
        if (e.status !== 409) throw e;
        await stopReplay(); // a run from another tab or before a refresh: replace it
        r = await startReplay(dataset, speed);
      }
      replayGen.current = r.gen;
      setTicks([]); setReplayEvents([]); setReplayRunning(true);
    } catch (e: any) { setReplayRunning(false); alert(e.message); }
  };
  // dashboard "Watch it work": 2025 crypto at ~10 days/second (about a minute end to end)
  const demo: Demo = {
    running: replayRunning, ticks, events: replayEvents,
    start: () => runReplay("crypto", 10),
    stop: () => { stopReplay(); setReplayRunning(false); },
    reset: () => { setTicks([]); setReplayEvents([]); },
  };

  if (missing) return <Onboard done={load} logout={logout} />;
  if (!acct) return <Splash />;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-20 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Logo onClick={() => navigate("/app")} />
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map(([r, l]) => (
              <button key={r} onClick={() => navigate(r)} aria-current={path === r ? "page" : undefined}
                className={"rounded-lg px-3 py-2 text-sm font-semibold transition " + (path === r ? "bg-ink-800 text-white" : "text-slate-400 hover:text-white")}>{l}</button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2"><AuditBadge /><StatusPill status={acct.status} kill={acct.kill_switch} /></div>
        </div>
        <div className="wire" aria-hidden />
      </header>

      {banner && path !== "/app" && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6">
          <div role="status" className="rise flex items-center gap-3 rounded-xl border border-sky-400/30 bg-sky-400/10 p-3 text-sm font-semibold text-sky-100">
            <Icon n="refresh" size={18} />{banner}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {path === "/replay" ? <Replay ticks={ticks} events={replayEvents} running={replayRunning} stocks={!!cfg.stocks} start={runReplay} />
          : path === "/backtest" ? <Backtest />
          : path === "/settings" ? <Settings acct={acct} cfg={cfg} voice={voice} toggleVoice={toggleVoice} reload={load} logout={logout} />
          : <Dashboard acct={acct} feed={feed} reasoning={reasoning} reload={load} voice={!!cfg.voice} live={live} demo={demo} cfg={cfg} />}
      </main>

      {/* mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {NAV.map(([r, l, ic]) => (
          <button key={r} onClick={() => navigate(r)} aria-current={path === r ? "page" : undefined}
            className={"flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold " + (path === r ? "text-white" : "text-slate-400")}>
            <Icon n={ic} size={20} />{l}
          </button>
        ))}
      </nav>
    </div>
  );
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo onClick={() => navigate("/")} />
        <button className="btn btn-primary" onClick={() => navigate("/")}>Get started</button>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">{children}</main>
    </div>
  );
}

function Splash() {
  return <div className="grid min-h-screen place-items-center text-sm text-slate-400" role="status">Loading your portfolio…</div>;
}

/** Header proof badge: Solana-anchored track record, or the local hash chain until the first anchor lands. */
function AuditBadge() {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    const f = () => api("/v1/audit/status").then(setS).catch(() => {});
    f(); const t = setInterval(f, 60000); return () => clearInterval(t);
  }, []);
  if (!s || !s.entries) return null;
  const anchored = !!s.signature;
  const cls = "hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold sm:inline-flex ";
  return anchored
    ? <a className={cls + "border-violet-400/40 bg-violet-400/10 text-violet-200 hover:border-violet-300"} href={`https://explorer.solana.com/tx/${s.signature}?cluster=${s.cluster}`} target="_blank" rel="noreferrer"
        title="Every trade and AI decision is fingerprinted; the chain head is written to Solana"><Icon n="chain" size={14} />Verified on Solana · {s.anchored_seq}</a>
    : <button className={cls + (s.chain_ok ? "border-ink-600 text-slate-300 hover:text-white" : "border-down/50 text-down")} onClick={() => navigate("/settings")}
        title="Tamper-evident hash chain of every trade and AI decision"><Icon n={s.chain_ok ? "check" : "alert"} size={14} />Audit chain {s.chain_ok ? "intact" : "BROKEN"} · {s.entries}</button>;
}
