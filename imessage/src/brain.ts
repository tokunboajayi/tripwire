// Pure logic for the iMessage agent: parse texts, decide replies, pick alerts. No I/O here (unit-tested).
export type Cmd =
  | { kind: "link"; code: string } | { kind: "help" } | { kind: "status" } | { kind: "pause" } | { kind: "resume" }
  | { kind: "safer" } | { kind: "riskier" } | { kind: "kill" } | { kind: "flatten" } | { kind: "yes" } | { kind: "no" }
  | { kind: "unlink" } | { kind: "ask"; text: string };

export function parse(raw: string): Cmd {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, "");
  const m = t.match(/^link\s+(\d{4})$/); if (m) return { kind: "link", code: m[1] };
  if (/^(help|commands|\?)$/.test(t)) return { kind: "help" };
  if (/^(status|how am i doing|portfolio|balance)$/.test(t)) return { kind: "status" };
  if (/^(pause|stop trading)$/.test(t)) return { kind: "pause" };
  if (/^(resume|start trading|unpause)$/.test(t)) return { kind: "resume" };
  if (/^(safer|less risk|be careful|lower risk)$/.test(t)) return { kind: "safer" };
  if (/^(riskier|more risk|raise risk|aggressive)$/.test(t)) return { kind: "riskier" };
  if (/^(kill|kill switch|stop everything)$/.test(t)) return { kind: "kill" };
  if (/^(sell everything|sell all|flatten)$/.test(t)) return { kind: "flatten" };
  if (/^(yes|y|confirm)$/.test(t)) return { kind: "yes" };
  if (/^(no|n|cancel)$/.test(t)) return { kind: "no" };
  if (/^unlink$/.test(t)) return { kind: "unlink" };
  return { kind: "ask", text: raw.trim() };
}

export const PROFILES = ["conservative", "balanced", "aggressive"] as const;
/** One step safer, or null if already at the safest profile. Texts can only tighten risk. */
export function saferProfile(p: string): string | null {
  const i = PROFILES.indexOf(p as any); return i > 0 ? PROFILES[i - 1] : null;
}

export const HELP = "Tripwire by text:\n• status — how you're doing\n• ask anything — \"why did you sell SOL?\"\n• pause / resume\n• safer — lower your risk one step\n• kill, sell everything (I'll ask you to confirm)\nRaising risk is dashboard-only, by design.";

/** Events worth a text. Everything else stays in the dashboard why-log. */
const ALERT_KINDS = new Set(["order", "gate_block", "auto_pause", "kill", "digest", "status"]);
export type Ev = { id: number; ts: number; kind: string; msg: string; account?: string | null };
export function alertText(e: Ev): string | null {
  if (!ALERT_KINDS.has(e.kind) || !e.msg) return null;
  if (e.kind === "status" && /iMessage/.test(e.msg)) return null; // don't echo link confirmations
  if (e.kind === "kill" && !e.account) return "🛑 " + e.msg;
  const icon = { order: "📈", gate_block: "🛡️", auto_pause: "⏸️", kill: "🛑", digest: "📝", status: "ℹ️" }[e.kind] ?? "";
  const m = e.msg.length > 280 ? e.msg.slice(0, 277) + "…" : e.msg;
  return `${icon} ${m}`.trim();
}

/** Merge several alerts into one text so a busy minute doesn't spam the user. */
export function bundle(lines: string[]): string | null {
  if (!lines.length) return null;
  return lines.length === 1 ? lines[0] : `Tripwire update (${lines.length}):\n` + lines.slice(-5).join("\n");
}

export function usd(n: number) { return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
export function statusText(a: any): string {
  const pos = (a.positions ?? []).map((p: any) => p.symbol?.split("/")[0]).filter(Boolean);
  return `${usd(a.equity)} (${a.pnl_total >= 0 ? "+" : ""}${usd(a.pnl_total)} total, ${a.pnl_today >= 0 ? "+" : ""}${usd(a.pnl_today)} today). ` +
    `Profile: ${a.profile}, ${a.status}. ${pos.length ? "Holding " + pos.join(", ") : "All cash"}. Goal ${Math.round((a.goal?.progress ?? 0) * 100)}% there.`;
}
