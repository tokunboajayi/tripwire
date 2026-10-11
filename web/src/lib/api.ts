// Engine API client (docs/03_BUILD_SPEC.md §9) + shared vocabulary from docs/01_IDEA.md.
let token = ""; // "dev:<name>" in dev mode, Auth0 access token otherwise
export const setToken = (t: string) => (token = t);
export const getToken = () => token;
/** Gets a fresh access token (Auth0 silent refresh); called once when the engine answers 401. */
let refresher: (() => Promise<string>) | null = null;
export const setRefresher = (f: typeof refresher) => (refresher = f);

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token.startsWith("dev:")) h["x-dev-user"] = token.slice(4);
  else if (token) h["authorization"] = `Bearer ${token}`;
  return h;
}

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const send = () => fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const net = (e: any) => Object.assign(new Error(e?.name === "TimeoutError" ? "The server took too long to answer" : "Can't reach the server"), { status: 0 });
  let r = await send().catch((e) => { throw net(e); });
  if (r.status === 401 && refresher) { // expired token: refresh once; if that fails the session is over (stay a 401)
    try { token = await refresher(); } catch { throw Object.assign(new Error("Your session expired"), { status: 401 }); }
    r = await send().catch((e) => { throw net(e); });
  }
  if (!r.ok) throw Object.assign(new Error((await r.text()) || r.statusText), { status: r.status });
  return r.json();
}

export const EVENT_KINDS = ["tick", "order", "gate_block", "regime", "ai_regime", "thesis", "limits", "status", "auto_pause", "digest", "kill",
  "account", "reasoning", "replay_tick", "replay_order", "replay_regime", "replay_done", "mirror", "anchor"] as const;
export type Ev = { id: number; ts: number; account?: string | null; kind: string; msg: string; data: any };
/** Latest live price per symbol from SSE `tick` events (engine refreshes every ~10s). */
export type LiveBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Live = Record<string, { price: number; prev: number; bar: LiveBar; ts: number }>;

/** SSE: tick, regime, order, gate_block, thesis, reasoning, digest… */
export function stream(onEvent: (kind: string, ev: Ev) => void) {
  const es = new EventSource(`/v1/stream?token=${encodeURIComponent(token)}`);
  for (const k of EVENT_KINDS) es.addEventListener(k, (e: MessageEvent) => onEvent(k, JSON.parse(e.data)));
  return () => es.close();
}

// ---------- vocabulary ----------
export type Profile = "conservative" | "balanced" | "aggressive";
export const PROFILE_ORDER: Profile[] = ["conservative", "balanced", "aggressive"];
/** Profile limits table (01_IDEA). AI may tighten, never loosen. Must match engine/src/risk.rs. */
export const PROFILES: Record<Profile, { label: string; blurb: string; risk: number; vol: number; maxpos: number; exposure: number; daily: number }> = {
  conservative: { label: "Conservative", blurb: "Small bets, quick to step aside. Sleeps well.", risk: 0.01, vol: 0.25, maxpos: 0.5, exposure: 0.6, daily: 0.02 },
  balanced: { label: "Balanced", blurb: "Real exposure when the setup is there, hard brakes when it isn't.", risk: 0.02, vol: 0.4, maxpos: 0.75, exposure: 0.85, daily: 0.04 },
  aggressive: { label: "Aggressive", blurb: "Bigger swings for bigger upside. Same hard limits, set higher.", risk: 0.03, vol: 0.6, maxpos: 1, exposure: 1, daily: 0.06 },
};

export type Regime = "RANGE" | "TREND_UP" | "HIGH_VOL" | "TREND_DOWN";
export type Brain = "MR" | "TREND" | "BREAKOUT" | "SHIELD";
export const REGIMES: Record<Regime, { label: string; color: string; brain: Brain }> = {
  RANGE: { label: "Calm", color: "#60A5FA", brain: "MR" },
  TREND_UP: { label: "Trending up", color: "#34D399", brain: "TREND" },
  HIGH_VOL: { label: "Volatile", color: "#F5B841", brain: "BREAKOUT" },
  TREND_DOWN: { label: "Falling", color: "#CBD5E1", brain: "SHIELD" },
};
export const BRAINS: Record<Brain, { label: string; does: string; glyph: "mr" | "trend" | "breakout" | "shield" }> = {
  MR: { label: "Mean-Reversion", does: "Buys sharp dips, sells the bounce", glyph: "mr" },
  TREND: { label: "Trend", does: "Rides the move, sized by volatility", glyph: "trend" },
  BREAKOUT: { label: "Breakout", does: "Buys confirmed breakouts, tight trailing stop", glyph: "breakout" },
  SHIELD: { label: "Shield", does: "Holds cash until the market turns", glyph: "shield" },
};

// ---------- formatting ----------
export const usd = (n: number, d = 2) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
export const signedUsd = (n: number) => (n > 0 ? "+" : "") + usd(n);
export const pct = (x: number, d = 0) => (x * 100).toFixed(d) + "%";
export const signedPct = (x: number, d = 1) => (x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
export const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---------- voice (ElevenLabs via the engine, key stays server-side) ----------
let voiceOn = false;
export const setVoice = (on: boolean) => (voiceOn = on);
// One voice at a time: a new line (or Stop) cancels the line that is loading or playing.
let current: { audio?: HTMLAudioElement; abort: AbortController; url?: string } | null = null;
const listeners = new Set<(speaking: boolean) => void>();
const notify = () => listeners.forEach((f) => f(!!current));
/** Subscribe to "is something speaking right now" (for Stop buttons). Returns an unsubscribe. */
export function onSpeaking(f: (speaking: boolean) => void) { listeners.add(f); f(!!current); return () => { listeners.delete(f); }; }
export function stopSpeaking() {
  if (!current) return;
  current.abort.abort(); current.audio?.pause();
  if (current.url) URL.revokeObjectURL(current.url);
  current = null; notify();
}

/** Speaks via the engine's ElevenLabs proxy. Resolves to an error message, or null when audio started (or was replaced). */
export async function speak(text: string, force = false): Promise<string | null> {
  if ((!voiceOn && !force) || !text) return null;
  stopSpeaking();
  const me = { abort: new AbortController() } as NonNullable<typeof current>;
  current = me; notify();
  const done = () => { if (current === me) { if (me.url) URL.revokeObjectURL(me.url); current = null; notify(); } };
  try {
    const r = await fetch(`/v1/voice?token=${encodeURIComponent(token)}&text=${encodeURIComponent(text)}`, { signal: me.abort.signal });
    if (!r.ok) {
      const why = (await r.text()) || `voice failed (${r.status})`;
      console.warn("voice:", why); done();
      return why;
    }
    const blob = await r.blob();
    if (current !== me) return null; // stopped or replaced while loading
    me.url = URL.createObjectURL(blob);
    me.audio = new Audio(me.url);
    me.audio.onended = done;
    await me.audio.play();
    return null;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return null; // cancelled on purpose
    done();
    const why = e instanceof Error && e.name === "NotAllowedError" ? "Browser blocked audio. Click anywhere on the page, then try again." : String(e);
    console.warn("voice:", why);
    return why;
  }
}
