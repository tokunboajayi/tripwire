import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { api, setToken, setVoice, speak, stream, type Ev, type Live } from "./lib/api";
import { navigate, usePath, type Route } from "./lib/router";
import { Logo } from "./components/Logo";
import { Icon, type IconName } from "./components/Icons";
import { StatusPill } from "./components/ui";
import Landing from "./pages/Landing";
import Onboard from "./pages/Onboard";
import Dashboard from "./pages/Dashboard";
import Replay, { startReplay, type ReplayTick } from "./pages/Replay";
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
      if (k === "replay_tick") return setTicks((t) => [...t, ev.data]);
      if (k === "replay_order") return setReplayEvents((e) => [ev, ...e].slice(0, 300));
      if (k === "replay_done") return setReplayRunning(false);
      if (k === "regime") { setBanner(ev.msg); speak(ev.msg); setTimeout(() => setBanner(""), 10000); }
      if (k === "order" && String(ev.data?.reason ?? "").startsWith("AI thesis")) speak(ev.msg);
      if (ev.msg) setFeed((f) => [ev, ...f].slice(0, 300));
      if (["order", "status", "limits", "auto_pause", "kill", "digest"].includes(k)) load();
    });
    return () => { clearInterval(poll); close(); };
  }, [!!acct]);

  const toggleVoice = () => { setVoice(!voice); setV(!voice); };
  const runReplay = (dataset: string) => {
    setTicks([]); setReplayEvents([]); setReplayRunning(true);
    startReplay(dataset).catch((e) => { setReplayRunning(false); alert(e.message); });
  };

  if (missing) return <Onboard done={load} logout={logout} />;
  if (!acct) return <Splash />;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Logo onClick={() => navigate("/app")} />
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map(([r, l]) => (
              <button key={r} onClick={() => navigate(r)} aria-current={path === r ? "page" : undefined}
                className={"rounded-lg px-3 py-2 text-sm font-semibold transition " + (path === r ? "bg-ink-800 text-white" : "text-slate-400 hover:text-white")}>{l}</button>
            ))}
          </nav>
          <div className="ml-auto"><StatusPill status={acct.status} kill={acct.kill_switch} /></div>
        </div>
      </header>

      {banner && (
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
          : <Dashboard acct={acct} feed={feed} reasoning={reasoning} reload={load} voice={!!cfg.voice} live={live} />}
      </main>

      {/* mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {NAV.map(([r, l, ic]) => (
          <button key={r} onClick={() => navigate(r)} aria-current={path === r ? "page" : undefined}
            className={"flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold " + (path === r ? "text-white" : "text-slate-500")}>
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
