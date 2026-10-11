// Full iMessage conversation against a running engine (DEV=1). Skipped unless VANTREL_E2E_API is set:
//   VANTREL_E2E_API=http://127.0.0.1:8099 bun test src/bot.e2e.test.ts
import { expect, test } from "bun:test";
import { createBot } from "./bot";

const API = process.env.VANTREL_E2E_API;
const TOKEN = process.env.INTERNAL_TOKEN || "change-me";
const USER = "imsg" + Date.now(), PHONE = "+1555" + String(Date.now()).slice(-7);
const dev = (path: string, method = "GET", body?: unknown) =>
  fetch(API + path, { method, headers: { "x-dev-user": USER, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

test.skipIf(!API)("iMessage: link, status, controls, tighten-only, confirmations, alerts, unlink", async () => {
  const bot = createBot({ api: API!, token: TOKEN });
  const say = (text: string, from = PHONE) => bot.handle(from, text);
  await dev("/v1/accounts", "POST", { profile: "balanced", start_cash: 5000, goal_amount: 500, goal_months: 6 });

  expect(await say("status")).toContain("link 1234");                        // unlinked phone is told how to connect
  expect(await say("link 0000")).toContain("didn't work");                   // wrong code
  const { code } = await dev("/v1/accounts/me/link-code", "POST");
  expect(await say(`link ${code}`)).toContain("Linked");

  expect(await say("status")).toMatch(/\$5,000.*balanced/);
  expect(await say("help")).toContain("safer");

  expect(await say("pause")).toContain("Paused");
  expect((await dev("/v1/accounts/me")).status).toBe("paused");
  expect(await say("resume")).toContain("Resumed");
  expect((await dev("/v1/accounts/me")).status).toBe("active");

  expect(await say("safer")).toContain("conservative");
  expect((await dev("/v1/accounts/me")).profile).toBe("conservative");
  expect(await say("safer")).toContain("already on Conservative");
  expect(await say("riskier")).toContain("dashboard-only");                  // texts can never raise risk
  expect((await dev("/v1/accounts/me")).profile).toBe("conservative");

  expect(await say("kill")).toContain("Reply YES");
  expect(await say("no")).toContain("Cancelled");
  expect((await dev("/v1/accounts/me")).status).toBe("active");
  expect(await say("kill")).toContain("Reply YES");
  expect(await say("yes")).toContain("Kill switch on");
  expect((await dev("/v1/accounts/me")).status).toBe("killed");
  expect(await say("yes")).toContain("Nothing to confirm");
  await dev("/v1/accounts/me/resume", "POST");

  expect(await say("sell everything")).toContain("Reply YES");
  expect(await say("yes")).toContain("Sold everything");
  expect(await say("why did you sell SOL?")).toContain("$");                 // no Claude key: plain status answer

  // outbound alerts: first poll primes, the next one texts new events
  const sent: [string, string][] = [];
  const send = async (p: string, t: string) => { sent.push([p, t]); };
  await bot.pollAlerts(send);
  expect(sent.length).toBe(0);
  await dev("/v1/accounts/me/agent-loosen", "POST");                         // produces a gate_block event
  await bot.pollAlerts(send);
  expect(sent.length).toBe(1);
  expect(sent[0][0]).toBe(PHONE);
  expect(sent[0][1]).toContain("LIMIT_LOOSEN_DENIED");

  // engine-enforced trust: the bridge token alone can't act for an account that never linked a phone
  const r = await fetch(API + "/v1/accounts/me", { headers: { "x-internal-token": TOKEN, "x-act-as": "dev|nobody" } });
  expect(r.status).toBe(401);
  expect(await say("status", "+19999999999")).toContain("link 1234");       // other phones get nothing

  expect(await say("unlink")).toContain("Unlinked");
  expect(await say("status")).toContain("link 1234");
}, 30_000);
