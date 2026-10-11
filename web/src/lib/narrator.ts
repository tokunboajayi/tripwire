// Narrated demo: turns the 2025 replay into spoken lines (ElevenLabs via speak()) plus on-screen captions.
// One voice at a time; while a line plays only the newest pending line is kept, so narration never lags the chart.
import { useEffect, useRef, useState } from "react";
import { onSpeaking, speak, stopSpeaking, type Ev } from "./api";

const COIN: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana" };
const month = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "long" });
const signed = (v: number) => `${v < 0 ? "down" : "up"} ${Math.abs(v).toFixed(1)} percent`;

export const INTRO = "2025, replayed. Ten thousand dollars of paper money, real daily prices, and the same Rust engine. Watch what it does when crypto falls.";

/** The line for a brain switch on the coin being watched, or null when it's not worth saying. */
export function switchLine(e: Ev, sym: string): string | null {
  const d = e.data || {};
  if (e.kind !== "replay_regime" || d.symbol !== sym || !d.t) return null;
  const coin = COIN[sym] || sym, m = month(d.t);
  switch (d.to) {
    case "TREND_DOWN": return `${m}: ${coin} turns down. Vantrel hands control to the Shield and steps into cash.`;
    case "TREND_UP": return `${m}: ${coin} starts trending up. The Trend brain takes over and rides it.`;
    case "HIGH_VOL": return `${m}: volatility spikes. The Breakout brain only buys confirmed moves.`;
    case "RANGE": return `${m}: the market goes quiet. Mean-reversion buys the dips and sells the bounces.`;
    default: return null;
  }
}

export const leadLine = (lead: number) => `Vantrel is now ${lead.toFixed(0)} points ahead of just holding.`;
export const outroLine = (vantrel: number, hold: number) =>
  `Done. Vantrel finished ${signed(vantrel)}. Just holding: ${signed(hold)}. The AI picked the brain. Rust held the line.`;

type Demo = { running: boolean; events: Ev[]; ticks: { equity: number; buy_hold: number }[] };

/** Drives narration for the dashboard demo. `voice` = ElevenLabs available; captions run either way. */
export function useNarration(demo: Demo, sym: string, voice: boolean) {
  const [on, setOn] = useState(() => { try { return localStorage.getItem("vt_narrate") !== "off"; } catch { return true; } });
  const [caption, setCaption] = useState<{ text: string; key: number } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false), pending = useRef<string | null>(null), seen = useRef(0), wasRunning = useRef(false), led = useRef(false), stopped = useRef(false);
  const live = useRef({ on, voice }); live.current = { on, voice };

  // each caption stays up long enough to read (also when the voice is off); the voice may hold it longer
  const holdUntil = useRef(0), holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const busy = () => speakingRef.current || Date.now() < holdUntil.current;
  const flush = () => { if (!busy() && pending.current) { const next = pending.current; pending.current = null; play(next); } };
  const play = (text: string) => {
    setCaption({ text, key: Date.now() });
    const hold = Math.max(2500, text.length * 55);
    holdUntil.current = Date.now() + hold;
    clearTimeout(holdTimer.current); holdTimer.current = setTimeout(flush, hold + 50);
    if (live.current.on && live.current.voice) speak(text, true);
  };
  const say = (text: string, now = false) => {
    if (!now && busy()) { pending.current = text; return; } // newest wins while a line is up
    pending.current = null; play(text);
  };
  useEffect(() => onSpeaking((s) => { speakingRef.current = s; setSpeaking(s); if (!s) flush(); }), []);
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  // start / finish
  useEffect(() => {
    if (demo.running && !wasRunning.current) { seen.current = 0; led.current = false; stopped.current = false; pending.current = null; say(INTRO, true); }
    if (!demo.running && wasRunning.current && !stopped.current) {
      const last = demo.ticks[demo.ticks.length - 1];
      if (last) say(outroLine((last.equity / 10_000 - 1) * 100, (last.buy_hold / 10_000 - 1) * 100), true);
    }
    wasRunning.current = demo.running;
  }, [demo.running]);

  // brain switches on the watched coin (events arrive newest first)
  useEffect(() => {
    if (!demo.running) return;
    const fresh = demo.events.filter((e) => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((e) => e.id));
    const line = fresh.map((e) => switchLine(e, sym)).find(Boolean); // newest worth saying
    if (line) say(line);
  }, [demo.events, sym]);

  // one "pulling ahead" moment
  useEffect(() => {
    const last = demo.ticks[demo.ticks.length - 1];
    if (!demo.running || led.current || !last) return;
    const lead = ((last.equity - last.buy_hold) / 10_000) * 100;
    if (lead >= 10) { led.current = true; say(leadLine(lead)); }
  }, [demo.ticks.length]);

  const toggle = () => setOn((v) => {
    const next = !v;
    try { localStorage.setItem("vt_narrate", next ? "on" : "off"); } catch {}
    if (!next) stopSpeaking();
    return next;
  });
  /** Call when the user stops the demo: no outro, silence now. */
  const cancel = () => { stopped.current = true; pending.current = null; clearTimeout(holdTimer.current); holdUntil.current = 0; stopSpeaking(); setCaption(null); };
  return { caption, speaking: speaking && on && voice, on, toggle, cancel, clear: () => setCaption(null) };
}
