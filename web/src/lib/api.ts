// Engine API client (docs/03_BUILD_SPEC.md §9) + shared vocabulary from docs/01_IDEA.md.
let token = ""; // "dev:<name>" in dev mode, Auth0 access token otherwise
export const setToken = (t: string) => (token = t);
export const getToken = () => token;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token.startsWith("dev:")) h["x-dev-user"] = token.slice(4);
  else if (token) h["authorization"] = `Bearer ${token}`;
  return h;
}

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
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
export const BRAINS: Record<Brain, { label: string; does: string }> = {
  MR: { label: "Mean-Reversion", does: "Buys sharp dips, sells the bounce" },
  TREND: { label: "Trend", does: "Rides the move, sized by volatility" },
  BREAKOUT: { label: "Breakout", does: "Buys confirmed breakouts, tight trailing stop" },
  SHIELD: { label: "Shield", does: "Holds cash until the market turns" },
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
export function speak(text: string, force = false) {
  if ((!voiceOn && !force) || !text) return;
  new Audio(`/v1/voice?token=${encodeURIComponent(token)}&text=${encodeURIComponent(text)}`).play().catch(() => {});
}
