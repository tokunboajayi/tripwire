// Every way to press Get started must move you forward without a full page reload.
import { chromium, devices } from "playwright-core";
const U = process.env.U || "http://localhost:8098";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
const results = [];
const check = (n, ok, d = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  -> " + d}`); };

async function attempt(label, ctxOpts, how) {
  const ctx = await b.newContext(ctxOpts); const p = await ctx.newPage();
  let loads = 0; p.on("load", () => loads++);
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(U + "/"); await p.waitForSelector("#nm1");
  await p.evaluate(() => (window.__same = true));
  const before = loads;
  await how(p);
  await p.waitForTimeout(3000);
  const same = await p.evaluate(() => window.__same === true).catch(() => false);
  const txt = (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 90);
  check(`${label}: no page reload`, same && loads === before, `reloaded=${!same} loads=${loads - before} url=${p.url()}`);
  check(`${label}: lands on onboarding`, /How much risk/.test(txt), txt);
  if (errs.length) console.log("   errors:", errs.join(" | "));
  await ctx.close();
}
const type = async (p, sel, s) => { await p.locator(sel).click(); await p.keyboard.type(s, { delay: 60 }); };

await attempt("desktop click (top)", {}, async (p) => { await type(p, "#nm1", "AJ"); await p.locator("#nm1 ~ button").click(); });
await attempt("desktop Enter key", {}, async (p) => { await type(p, "#nm1", "AJ"); await p.keyboard.press("Enter"); });
await attempt("desktop click (bottom)", {}, async (p) => { await p.locator("#nm2").scrollIntoViewIfNeeded(); await type(p, "#nm2", "AJ"); await p.locator("#nm2 ~ button").click(); });
await attempt("iPhone tap", { ...devices["iPhone 13"] }, async (p) => { await p.locator("#nm1").tap(); await p.keyboard.type("AJ", { delay: 60 }); await p.locator("#nm1 ~ button").tap(); });
await attempt("Android tap + Go key", { ...devices["Pixel 7"] }, async (p) => { await p.locator("#nm1").tap(); await p.keyboard.type("AJ", { delay: 60 }); await p.keyboard.press("Enter"); });
await attempt("click before typing (button disabled), then type + click", {}, async (p) => { await p.locator("#nm1 ~ button").click({ force: true }); await type(p, "#nm1", "AJ"); await p.locator("#nm1 ~ button").click(); });

await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
