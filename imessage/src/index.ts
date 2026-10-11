// Vantrel iMessage agent (Photon Spectrum). Texts you when Vantrel acts; text back to ask or control.
// Trust rules (enforced by the Rust engine, not here): this bridge can act only for accounts that linked a
// phone themselves, and risk changes by text can only tighten. Kill / sell-everything need a YES reply.
import { readFileSync, existsSync } from "node:fs";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { createBot } from "./bot";

for (const f of ["../.env", ".env"]) if (existsSync(f)) for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
}
const env = (k: string, d = "") => process.env[k] || d;
const API = env("VANTREL_API", "http://127.0.0.1:8080"), TOKEN = env("INTERNAL_TOKEN", "change-me");
const POLL_MS = Number(env("IMESSAGE_POLL_S", "20")) * 1000;
const cloud = !!(env("PHOTON_PROJECT_ID") && env("PHOTON_PROJECT_SECRET"));

const bot = createBot({ api: API, token: TOKEN, anthropicKey: env("ANTHROPIC_API_KEY"), model: env("THESIS_MODEL", "claude-haiku-5-5") });
const { call, handle, pollAlerts } = bot;

const app = cloud
  ? await Spectrum({ projectId: env("PHOTON_PROJECT_ID"), projectSecret: env("PHOTON_PROJECT_SECRET"), providers: [imessage.config()] })
  : await (Spectrum as any)({ providers: [terminal.config()] });
console.log(`vantrel imessage agent: ${cloud ? "Photon iMessage" : "terminal (set PHOTON_PROJECT_ID/SECRET for iMessage)"} -> ${API}`);

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
  try { await send(to, "Vantrel test: if you see this, outbound iMessage works. Reply \"help\"."); process.exit(0); }
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
