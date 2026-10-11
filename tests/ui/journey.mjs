// Real-browser user journey against a production-configured engine (no DEV, no Auth0): what a judge actually does.
//   U=http://localhost:8098 node journey.mjs        (CHROME=/path/to/chrome to use a local browser)
import { chromium } from "playwright-core";

const U = process.env.U || "http://localhost:8098";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
const results = [], errors = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  -> ${detail}`}`); };
const page = async (w = 1280, h = 860) => { const p = await b.newPage({ viewport: { width: w, height: h } }); p.on("pageerror", (e) => errors.push(e.message)); return p; };
const body = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160);
const has = async (p, t) => (await p.locator(`text=${t}`).count()) > 0;
const signUp = async (p, name) => {
  await p.goto(U + "/"); await p.waitForSelector("#nm1");
  await p.locator("#nm1").pressSequentially(name, { delay: 50 });
  check(`typing "${name}" keeps focus in the name box`, (await p.inputValue("#nm1")) === name, await p.inputValue("#nm1"));
  await p.click("button:has-text('Get started')");
};
const fund = async (p) => {
  await p.click("text=Continue"); await p.click("text=Continue"); await p.click("text=Fund & start trading");
  await p.waitForURL("**/app", { timeout: 15000 }); await p.waitForSelector("text=Portfolio value", { timeout: 15000 });
};

try {
  const p = await page();
  await signUp(p, "AJ");
  await p.waitForTimeout(2000);
  check("Get started -> onboarding (not 'session expired')", await has(p, "How much risk"), await body(p));
  await fund(p);
  check("fund -> dashboard shows the portfolio", await has(p, "Portfolio value"));
  await p.reload(); await p.waitForTimeout(2500);
  check("reload keeps you signed in", await has(p, "Portfolio value"), await body(p));
  await p.goto(U + "/settings"); await p.waitForTimeout(2000);
  check("refresh on /settings stays on Settings", p.url().endsWith("/settings") && await has(p, "Sign out"), p.url() + " " + await body(p));
  await p.goto(U + "/replay"); await p.waitForTimeout(2000);
  check("refresh on /replay stays on Replay", p.url().endsWith("/replay") && await has(p, "Replay:"), p.url() + " " + await body(p));

  await p.goto(U + "/app"); await p.waitForSelector("text=Ask the AI to raise its risk");
  await p.click("text=Ask the AI to raise its risk"); await p.waitForTimeout(1500);
  const why = (await p.locator("body").innerText()).match(/AI asked[^\n]*/)?.[0] || "";
  check("AI risk request shows Rust's reason (at your ceiling)", /LIMIT_LOOSEN_DENIED/.test(why) && /ceiling/.test(why), why);

  await p.click("text=Watch it survive 2025"); await p.waitForTimeout(6000);
  check("2025 demo replay streams onto the dashboard", await has(p, "Just holding"), await body(p));
  await p.click("text=Stop and go live").catch(() => {});

  await p.goto(U + "/settings"); await p.waitForSelector("text=Sign out"); await p.click("text=Sign out"); await p.waitForSelector("#nm1");
  await signUp(p, "AJ"); await p.waitForTimeout(3000);
  check("sign out, same name again -> your portfolio is back", p.url().endsWith("/app") && await has(p, "Portfolio value"), p.url() + " " + await body(p));

  const q = await page();
  await q.goto(U + "/"); await q.evaluate(() => localStorage.setItem("vt_user", "AJ")); await q.goto(U + "/app"); await q.waitForTimeout(3000);
  check("old name-only login upgrades itself", !/session expired/i.test(await body(q)) && (await has(q, "How much risk") || await has(q, "Portfolio value")), await body(q));

  const r = await page();
  await signUp(r, "Alice.0123456789abcdef"); await r.waitForTimeout(1500);
  const id = await r.evaluate(() => localStorage.getItem("vt_user"));
  check("a typed name never becomes the secret key", id && !id.endsWith(".0123456789abcdef") && /\.[0-9a-f]{16}$/.test(id), id);

  const m = await page(390, 844);
  await signUp(m, "Mo"); await m.waitForTimeout(1500); await fund(m);
  check("phone width: sign-up to dashboard, no sideways scroll", (await m.evaluate(() => document.documentElement.scrollWidth)) <= 390);
} catch (e) {
  check("journey ran to the end", false, e.message.split("\n")[0]);
}
check("no JavaScript errors", errors.length === 0, JSON.stringify(errors));
await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
