// Message handling for the iMessage agent, separate from the Spectrum transport so it can be tested against a real engine.
// Trust rules are enforced by the Rust engine: x-act-as works only for accounts that linked a phone themselves,
// and risk changes arriving this way can only tighten.
import { parse, saferProfile, HELP, alertText, bundle, statusText, type Ev } from "./brain";

export type BotConfig = { api: string; token: string; anthropicKey?: string; model?: string };

export function createBot(cfg: BotConfig) {
  const API = cfg.api, TOKEN = cfg.token;
  async function call(path: string, user?: string, init: RequestInit = {}) {
    const h: Record<string, string> = { "x-internal-token": TOKEN, "content-type": "application/json" };
    if (user) h["x-act-as"] = user;
    const r = await fetch(API + path, { ...init, headers: h });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof body === "string" ? body : (body.error ?? r.statusText));
    return body;
  }

  // ---- answer free-text questions with Claude (falls back to a plain status line) ----
  async function answer(user: string, q: string): Promise<string> {
    const [acct, events, regimes] = await Promise.all([call("/v1/accounts/me", user), call("/v1/accounts/me/events", user), call("/v1/market/regimes")]);
    const key = cfg.anthropicKey;
    if (!key) return statusText(acct) + " (Ask me in the dashboard for details.)";
    delete acct.mcp_token;
    const ctx = JSON.stringify({ account: acct, recent_events: events.slice(0, 15).map((e: Ev) => ({ kind: e.kind, msg: e.msg })), regimes });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.model ?? "claude-haiku-5-5", max_tokens: 400,
        system: "You are Vantrel, a paper-trading AI texting its user over iMessage. Answer in under 45 words, plain English, no jargon, no markdown. Use only the JSON data given. Never promise returns. If asked to raise risk, say that is dashboard-only.",
        messages: [{ role: "user", content: `Data: ${ctx}\n\nQuestion: ${q}` }] }),
    });
    const j: any = await r.json();
    return (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim() || statusText(acct);
  }

  const pending = new Map<string, { action: "kill" | "flatten"; exp: number }>(); // phone -> awaiting YES

  async function handle(phone: string, text: string): Promise<string> {
    const cmd = parse(text);
    if (cmd.kind === "link") {
      try { await call("/internal/link", undefined, { method: "POST", body: JSON.stringify({ code: cmd.code, phone }) }); return "Linked ✅ I'll text you when Vantrel trades, blocks an order or pauses. Text \"help\" for commands."; }
      catch { return "That code didn't work or expired. Get a fresh one on the dashboard (Settings → Text me)."; }
    }
    const phones: { user: string; phone: string }[] = await call("/internal/phones");
    const user = phones.find((p) => p.phone === phone)?.user;
    if (!user) return "Hi, I'm Vantrel. To connect, open the dashboard, tap \"Text me\" and send: link 1234 (your code).";
    const act = (a: string) => call(`/v1/accounts/me/${a}`, user, { method: "POST" });
    switch (cmd.kind) {
      case "help": return HELP;
      case "status": return statusText(await call("/v1/accounts/me", user));
      case "pause": await act("pause"); return "Paused ⏸️ No new trades. Open positions keep their stops. Text \"resume\" to restart.";
      case "resume": await act("resume"); return "Resumed ▶️ Back to trading on your profile.";
      case "unlink": await act("unlink-phone"); return "Unlinked. You won't get texts anymore.";
      case "riskier": return "Raising risk is dashboard-only. That's on purpose: a text can make Vantrel safer, never riskier.";
      case "safer": {
        const a = await call("/v1/accounts/me", user); const next = saferProfile(a.profile);
        if (!next) return "You're already on Conservative, the safest profile.";
        await call("/v1/accounts/me/profile", user, { method: "PATCH", body: JSON.stringify({ profile: next }) });
        return `Done 🛡️ Profile lowered to ${next}. Smaller positions, tighter daily loss stop.`;
      }
      case "kill": case "flatten":
        pending.set(phone, { action: cmd.kind, exp: Date.now() + 120_000 });
        return cmd.kind === "kill" ? "Turn on your kill switch? No new trades until you turn it off in the dashboard. Reply YES to confirm." : "Sell every position now at market? Reply YES to confirm.";
      case "yes": {
        const p = pending.get(phone); pending.delete(phone);
        if (!p || p.exp < Date.now()) return "Nothing to confirm.";
        await act(p.action); return p.action === "kill" ? "🛑 Kill switch on. No new orders." : "Sold everything. You're in cash.";
      }
      case "no": pending.delete(phone); return "Cancelled. Nothing changed.";
      case "ask": return answer(user, cmd.text);
    }
  }

    // ---- outbound alerts: poll each linked account's why-log, text new events (max one bundled text per poll) ----
  const seen = new Map<string, number>();
  async function pollAlerts(send: (phone: string, text: string) => Promise<void>) {
    const phones: { user: string; phone: string }[] = await call("/internal/phones").catch(() => []);
    for (const { user, phone } of phones) {
      const evs: Ev[] = await call("/v1/accounts/me/events", user).catch(() => []);
      const last = seen.get(user); const max = Math.max(0, ...evs.map((e) => e.id)); seen.set(user, max);
      if (last === undefined) continue; // first pass: don't replay history
      const msg = bundle(evs.filter((e) => e.id > last).sort((a, b) => a.id - b.id).map(alertText).filter((x): x is string => !!x));
      if (msg) await send(phone, msg).catch((e) => console.error("send failed", phone, e.message));
    }
  }

  return { call, handle, pollAlerts };
}
