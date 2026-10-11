import { useState } from "react";
import { time, type Ev } from "../lib/api";
import { Icon, type IconName } from "./Icons";
import { Empty } from "./ui";

const KIND: Record<string, { icon: IconName; tone: string }> = {
  order: { icon: "trade", tone: "text-up bg-up/10" },
  gate_block: { icon: "shieldOff", tone: "text-down bg-down/10" },
  auto_pause: { icon: "pause", tone: "text-wire bg-wire/10" },
  kill: { icon: "power", tone: "text-down bg-down/10" },
  regime: { icon: "refresh", tone: "text-sky-300 bg-sky-400/10" },
  ai_regime: { icon: "bolt", tone: "text-violet-300 bg-violet-400/10" },
  thesis: { icon: "note", tone: "text-violet-300 bg-violet-400/10" },
  digest: { icon: "note", tone: "text-slate-300 bg-slate-400/10" },
  limits: { icon: "proof", tone: "text-sky-300 bg-sky-400/10" },
  status: { icon: "ok", tone: "text-slate-300 bg-slate-400/10" },
  account: { icon: "wallet", tone: "text-up bg-up/10" },
  mirror: { icon: "external", tone: "text-slate-300 bg-slate-400/10" },
  anchor: { icon: "chain", tone: "text-slate-300 bg-slate-400/10" },
};

const FILTERS: [string, string, (k: string) => boolean][] = [
  ["all", "All", () => true],
  ["trades", "Trades", (k) => k === "order" || k === "mirror"],
  ["blocked", "Blocked", (k) => k === "gate_block" || k === "auto_pause" || k === "kill"],
  ["ai", "AI", (k) => ["thesis", "ai_regime", "regime", "digest", "limits"].includes(k)],
];

/** Why-log: every action with one plain-English sentence. Gate blocks show their code and check time. */
export function WhyLog({ items, limit, filters = true, live = true }: { items: Ev[]; limit?: number; filters?: boolean; live?: boolean }) {
  const [f, setF] = useState("all");
  const fn = FILTERS.find((x) => x[0] === f)![2];
  const shown = items.filter((e) => e.msg && !e.kind.startsWith("replay") && fn(e.kind)).slice(0, limit);
  return (
    <div>
      {filters && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter why-log">
          {FILTERS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={f === k} onClick={() => setF(k)}
              className={"rounded-full px-3 py-1 text-xs font-semibold transition " + (f === k ? "bg-white text-ink-950" : "bg-ink-800 text-slate-400 hover:text-white")}>
              {l}
            </button>
          ))}
        </div>
      )}
      {shown.length ? (
        <ol className="space-y-1" aria-live={live ? "polite" : "off"}>
          {shown.map((e) => {
            const k = KIND[e.kind] ?? { icon: "activity" as IconName, tone: "text-slate-300 bg-slate-400/10" };
            const blocked = e.kind === "gate_block";
            return (
              <li key={`${e.id}-${e.kind}-${e.ts}`} className={"rise flex gap-3 rounded-xl p-2.5 " + (blocked ? "bg-down/5 ring-1 ring-down/20" : "")}>
                <span className={"mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg " + k.tone}><Icon n={k.icon} size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className={"text-sm leading-snug " + (blocked ? "text-red-200" : "text-slate-200")}>{e.msg}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <time dateTime={new Date(e.ts * 1000).toISOString()}>{time(e.ts)}</time>
                    {blocked && e.data?.code && (
                      <code className="rounded bg-down/15 px-1.5 py-0.5 font-mono font-semibold text-red-300">
                        {e.data.code}{e.data.latency_ns != null ? ` · ${(e.data.latency_ns / 1000).toFixed(1)}µs` : ""}
                      </code>
                    )}
                    {e.kind === "order" && e.data?.latency_ns != null && <span className="font-mono">gate OK · {(e.data.latency_ns / 1000).toFixed(1)}µs</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty>Nothing yet. Every trade, AI decision and blocked order shows up here with a plain-English reason.</Empty>
      )}
    </div>
  );
}
