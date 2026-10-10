// Tripwire iMessage agent (Photon Spectrum). Texts you when Tripwire acts; text back to ask or control.
// Trust rules (enforced by the Rust engine, not here): this bridge can act only for accounts that linked a
// phone themselves, and risk changes by text can only tighten. Kill / sell-everything need a YES reply.
import { readFileSync, existsSync } from "node:fs";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { parse, saferProfile, HELP, alertText, bundle, statusText, type Ev } from "./brain";

for (const f of ["../.env", ".env"]) if (existsSync(f)) for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
}
const env = (k: string, d = "") => process.env[k] || d;
const API = env("TRIPWIRE_API", "http://127.0.0.1:8080"), TOKEN = env("INTERNAL_TOKEN", "change-me");
const POLL_MS = Number(env("IMESSAGE_POLL_S", "20")) * 1000;
const cloud = !!(env("PHOTON_PROJECT_ID") && env("PHOTON_PROJECT_SECRET"));

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
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return statusText(acct) + " (Ask me in the dashboard for details.)";
  delete acct.mcp_token;
  const ctx = JSON.stringify({ account: acct, recent_events: events.slice(0, 15).map((e: Ev) => ({ kind: e.kind, msg: e.msg })), regimes });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env("THESIS_MODEL", "claude-haiku-5-5"), max_tokens: 400,
      system: "You are Tripwire, a paper-trading AI texting its user over iMessage. Answer in under 45 words, plain English, no jargon, no markdown. Use only the JSON data given. Never promise returns. If asked to raise risk, say that is dashboard-only.",
      messages: [{ role: "user", content: `Data: ${ctx}\n\nQuestion: ${q}` }] }),
  });
  const j: any = await r.json();
  return (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim() || statusText(acct);
}

const pending = new Map<string, { action: "kill" | "flatten"; exp: number }>(); // phone -> awaiting YES

async function handle(phone: string, text: string): Promise<string> {
  const cmd = parse(text);
  if (cmd.kind === "link") {
    try { await call("/internal/link", undefined, { method: "POST", body: JSON.stringify({ code: cmd.code, phone }) }); return "Linked ✅ I'll text you when Tripwire trades, blocks an order or pauses. Text \"help\" for commands."; }
    catch { return "That code didn't work or expired. Get a fresh one on the dashboard (Live tab → Text me)."; }
  }
  const phones: { user: string; phone: string }[] = await call("/internal/phones");
  const user = phones.find((p) => p.phone === phone)?.user;
  if (!user) return "Hi, I'm Tripwire. To connect, open the dashboard, tap \"Text me\" and send: link 1234 (your code).";
  const act = (a: string) => call(`/v1/accounts/me/${a}`, user, { method: "POST" });
  switch (cmd.kind) {
    case "help": return HELP;
    case "status": return statusText(await call("/v1/accounts/me", user));
    case "pause": await act("pause"); return "Paused ⏸️ No new trades. Open positions keep their stops. Text \"resume\" to restart.";
    case "resume": await act("resume"); return "Resumed ▶️ Back to trading on your profile.";
    case "unlink": await act("unlink-phone"); return "Unlinked. You won't get texts anymore.";
    case "riskier": return "Raising risk is dashboard-only. That's on purpose: a text can make Tripwire safer, never riskier.";
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

const app = cloud
  ? await Spectrum({ projectId: env("PHOTON_PROJECT_ID"), projectSecret: env("PHOTON_PROJECT_SECRET"), providers: [imessage.config()] })
  : await (Spectrum as any)({ providers: [terminal.config()] });
console.log(`tripwire imessage agent: ${cloud ? "Photon iMessage" : "terminal (set PHOTON_PROJECT_ID/SECRET for iMessage)"} -> ${API}`);

const im: any = cloud ? imessage(app) : null;
const send = async (phone: string, text: string) => {
  if (!im) { console.log(`[text to ${phone}] ${text}`); return; }
  console.log(`-> sending to ${phone}: ${text.slice(0, 60)}`);
  const space = await im.space.create(phone); await space.send(text);
  console.log(`   sent ok to ${phone}`);
};

// Diagnostic: bun src/index.ts --ping +14045551234  -> sends one test text and exits
const pi = process.argv.indexOf("--ping");
if (pi > -1) {
  const to = process.argv[pi + 1];
  if (!to) { console.error("usage: bun src/index.ts --ping +1XXXXXXXXXX"); process.exit(1); }
  try { await send(to, "Tripwire test: if you see this, outbound iMessage works. Reply \"help\"."); process.exit(0); }
  catch (e: any) { console.error("PING FAILED:", e?.message ?? e); process.exit(1); }
}

// Startup status: which phones are linked (alerts only go to linked phones)
call("/internal/phones").then((p: any[]) => console.log(p.length ? `linked phones: ${p.map((x) => x.phone).join(", ")}` : "linked phones: NONE. Text \"link <code>\" from the dashboard's Text me button to the Photon number."))
  .catch((e) => console.error("cannot reach engine:", e.message));
setInterval(() => pollAlerts(send).catch((e) => console.error("poll", e.message)), POLL_MS);

for await (const [space, msg] of (app as any).messages) {
  if (msg.direction !== "inbound") continue;
  const c: any = msg.content; const text = c?.type === "text" ? c.text : c?.type === "markdown" ? c.markdown : "";
  if (!text) continue;
  const phone = cloud ? (msg.sender?.id ?? space.id) : "terminal";
  console.log(`<- inbound from ${phone}: ${text.slice(0, 60)}`);
  const run = async () => { try { await msg.reply(await handle(phone, text)); } catch (e: any) { await msg.reply("Something went wrong on my side: " + e.message); } };
  typeof space.responding === "function" ? await space.responding(run) : await run();
}
