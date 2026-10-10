let token = ""; // "dev:<name>" in dev mode, Auth0 access token otherwise
export const setToken = (t: string) => (token = t);
export const getToken = () => token;
function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token.startsWith("dev:")) h["x-dev-user"] = token.slice(4); else if (token) h["authorization"] = `Bearer ${token}`;
  return h;
}
export async function api<T = any>(path: string, method = "GET", body?: any): Promise<T> {
  const r = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw Object.assign(new Error(await r.text()), { status: r.status });
  return r.json();
}
export function stream(onEvent: (kind: string, ev: any) => void) {
  const es = new EventSource(`/v1/stream?token=${encodeURIComponent(token)}`);
  for (const k of ["order", "gate_block", "regime", "ai_regime", "thesis", "limits", "status", "auto_pause", "digest", "kill", "account", "reasoning", "replay_tick", "replay_order", "replay_done", "mirror"])
    es.addEventListener(k, (e: MessageEvent) => onEvent(k, JSON.parse(e.data)));
  return () => es.close();
}
export const PROFILES = {
  conservative: { risk: "1%", maxpos: "50%", vol: "25%", loss: "2%" },
  balanced: { risk: "2%", maxpos: "75%", vol: "40%", loss: "4%" },
  aggressive: { risk: "3%", maxpos: "100%", vol: "60%", loss: "6%" },
};
export const REGIME_COLOR: Record<string, string> = { RANGE: "#4c8bf5", TREND_UP: "#2bb673", HIGH_VOL: "#f29d38", TREND_DOWN: "#8a8f98" };
export const usd = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

let voiceOn = false;
export const setVoice = (on: boolean) => (voiceOn = on);
/** Speak an alert through the engine's ElevenLabs proxy (key stays server-side). */
export function speak(text: string) {
  if (!voiceOn || !text) return;
  new Audio(`/v1/voice?token=${encodeURIComponent(token)}&text=${encodeURIComponent(text)}`).play().catch(() => {});
}
