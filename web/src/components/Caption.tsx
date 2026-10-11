import { useEffect, useState } from "react";
import { Icon } from "./Icons";

/** Lower-third for the narrated demo: the spoken line, typed on, with a live voice meter. */
export function Caption({ text, speaking, on, voice, onToggle }: { text: string; speaking: boolean; on: boolean; voice: boolean; onToggle: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(text.length); return; }
    setN(0);
    const step = Math.max(1, Math.round(text.length / 90)); // ~2.5s to type any line
    const t = setInterval(() => setN((k) => (k >= text.length ? (clearInterval(t), k) : Math.min(text.length, k + step))), 28);
    return () => clearInterval(t);
  }, [text]);
  return (
    <div data-caption className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-6">
      <div className="caption-in pointer-events-auto relative w-full max-w-2xl overflow-hidden rounded-lg border border-wire/30 bg-ink-950/90 shadow-2xl backdrop-blur">
        <div className="wire-grow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-wire via-wire/70 to-transparent" />
        <div className="flex items-start gap-3 p-4">
          <div className={"mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-wire/40 " + (speaking ? "text-wire" : "text-slate-500")} aria-hidden>
            {speaking ? <div className="eq flex h-3.5 items-end gap-[2px]"><span /><span /><span /><span /></div> : <Icon n={on && voice ? "volume" : "mute"} size={14} />}
          </div>
          <p aria-live="polite" className="min-h-[2.75rem] flex-1 text-[15px] leading-snug text-slate-100">
            <span className="sr-only">{text}</span>
            <span aria-hidden>{text.slice(0, n)}<span className={n < text.length ? "ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-wire" : "hidden"} /></span>
          </p>
          {voice && (
            <button className="btn btn-ghost shrink-0 px-2 py-1 text-xs" onClick={onToggle} aria-pressed={on} title={on ? "Mute narration" : "Turn narration on"}>
              <Icon n={on ? "volume" : "mute"} size={14} />{on ? "Voice on" : "Voice off"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
