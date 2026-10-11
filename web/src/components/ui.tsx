import type { ReactNode } from "react";
import { BRAINS, REGIMES, type Brain, type Regime } from "../lib/api";

export function Tile({ label, children, sub, className = "" }: { label: string; children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={"card p-5 " + className}>
      <div className="label">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white num">{children}</div>
      {sub && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  );
}

export function BrainBadge({ regime, size = "md" }: { regime: Regime; size?: "sm" | "md" }) {
  const r = REGIMES[regime];
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full border font-semibold " + (size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm")}
      style={{ color: r.color, borderColor: r.color + "55", background: r.color + "14" }}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
      {BRAINS[r.brain].label}
    </span>
  );
}

export function brainOf(b: Brain) { return BRAINS[b]?.label ?? b; }

export function StatusPill({ status, kill }: { status: string; kill?: boolean }) {
  const s = kill ? "killed" : status;
  const cfg = s === "active" ? ["Trading", "bg-up", "text-up"] : s === "paused" ? ["Paused", "bg-wire", "text-wire"] : ["Kill switch on", "bg-down", "text-down"];
  return (
    <span className={"inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-850 px-3 py-1 text-sm font-semibold " + cfg[2]}>
      <span className="relative flex h-2 w-2">
        {s === "active" && <span className={"absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 " + cfg[1]} />}
        <span className={"relative inline-flex h-2 w-2 rounded-full " + cfg[1]} />
      </span>
      {cfg[0]}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-600 p-6 text-center text-sm text-slate-400">{children}</div>;
}
