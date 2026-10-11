// Records the demo in a real browser at 1920x1080: animated cards + the live app, paced by out/timing.json.
// Writes out/raw/*.webm and out/marks.json (when each scene starts, for laying the narration under it).
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, renameSync } from "node:fs";
import { SCENES } from "./script.mjs";

const U = (process.env.U || "http://localhost:8080").replace(/\/$/, "");
const timing = JSON.parse(readFileSync("out/timing.json", "utf8"));
const overlay = readFileSync(new URL("./overlay.js", import.meta.url), "utf8");
rmSync("out/raw", { recursive: true, force: true }); mkdirSync("out/raw", { recursive: true });

const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: "out/raw", size: { width: 1920, height: 1080 } } });
await ctx.addInitScript(overlay);
await ctx.addInitScript(() => { try { localStorage.setItem("vt_narrate", "off"); } catch {} }); // the video has its own voice
await ctx.route("**/v1/replays", async (r) => { // replay speed chosen so 2025 → today plays while its narration does
  if (r.request().method() !== "POST") return r.continue();
  const days = (Date.now() / 1000 - Date.UTC(2025, 0, 1) / 1000) / 86400;
  const body = { ...(r.request().postDataJSON() || {}), speed: Math.min(200, Math.max(15, days / Math.max(8, (timing.replay || 20) - 3))) };
  return r.continue({ postData: JSON.stringify(body) });
});
const p = await ctx.newPage();
const t0 = Date.now(), marks = {};
const vt = (fn, ...a) => p.evaluate(([f, args]) => window.__vt[f](...args), [fn, a]);
const hl = async (loc, label) => { const h = await loc.first().elementHandle({ timeout: 3000 }).catch(() => null); if (h) await p.evaluate(([el, l]) => window.__vt.highlight(el, l), [h, label]); };
const glide = async (loc) => { const bx = await loc.first().boundingBox(); if (bx) await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2, { steps: 18 }); return bx; };
const click = async (loc) => { await loc.first().scrollIntoViewIfNeeded(); await glide(loc); await p.waitForTimeout(150); await loc.first().click(); };
const type = async (loc, text) => { await click(loc); await p.keyboard.type(text, { delay: 75 }); };
const pause = (ms) => p.waitForTimeout(ms);
// scene clicks are paced as shares of the scene's narration, so the picture never outruns the voice
let sceneMs = 6000, sceneStart = Date.now();
const beat = (share) => pause(Math.max(400, share * sceneMs));

const acts = {
  async signup() {
    await type(p.locator("#nm1"), "Ada");
    await click(p.locator("#nm1 ~ button"));
    await p.waitForSelector("text=How much risk");
    await hl(p.locator("text=Risk per dip").first().locator("../.."), "HARD LIMITS · ENFORCED IN RUST"); await beat(0.3);
    await vt("clearHighlights"); await click(p.locator("text=Continue")); await pause(500);
    await click(p.locator("text=Continue")); await pause(500);
    await click(p.locator("text=Fund & start trading"));
    await p.waitForSelector("text=Portfolio value", { timeout: 20000 });
  },
  async dashboard() {
    await hl(p.locator("text=Brain in charge now").locator(".."), "THE BRAIN THE AI PICKED"); await beat(0.42);
    await hl(p.locator("[role=meter]"), "RISK WIRE · AUTO-PAUSE LINE"); await glide(p.locator("[role=meter]")); await beat(0.42);
  },
  async wire() {
    const btn = p.locator("text=Ask the AI to raise its risk");
    await btn.first().scrollIntoViewIfNeeded();
    await hl(btn, "THE AI ASKS FOR MORE RISK"); await beat(0.22); await vt("clearHighlights");
    await click(btn); await pause(700);
    const blocked = p.locator("text=/Blocked: (LIMIT_LOOSEN_DENIED|RISK_NOT_EARNED)/");
    await blocked.first().scrollIntoViewIfNeeded().catch(() => {});
    await hl(blocked, "RUST SAYS NO"); await beat(0.45);
  },
  async replay() {
    await p.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await click(p.locator("button:has-text('Watch it survive 2025')"));
    await p.waitForSelector("text=Just holding", { timeout: 15000 });
    await hl(p.locator("text=Just holding").locator("../.."), "VANTREL VS JUST HOLDING · LIVE");
    await p.waitForSelector("text=Replay again", { timeout: 120000 });
  },
  async result() {
    await hl(p.locator("text=Just holding").locator("../.."), "FINAL · REAL PRICES · FEES INCLUDED"); await beat(0.85);
  },
  async proof() {
    await click(p.locator("nav >> text=Settings")); await p.waitForSelector("text=Verify the track record");
    await hl(p.locator("section").filter({ hasText: "Verify the track record" }), "ANCHORED ON SOLANA"); await beat(0.42);
    await hl(p.locator("section").filter({ hasText: "Talk to your portfolio" }), "ASK CLAUDE · MCP"); await beat(0.42);
  },
};

await p.goto(U + "/"); await p.waitForSelector("#nm1", { timeout: 30000 });
for (const [i, s] of SCENES.entries()) {
  const start = Date.now(); marks[s.id] = (start - t0) / 1000;
  sceneMs = (timing[s.id] || 6) * 1000; sceneStart = start;
  await vt("stamp", i);
  const dur = (timing[s.id] || 6) * 1000;
  await vt("clearHighlights");
  if (s.card) { await vt("clearCaption"); await vt("card", s.card); }
  else { await vt("clearCard"); await vt("caption", s.say); }
  if (s.act) await acts[s.act]();
  const left = dur - (Date.now() - start);
  if (left > 0) await pause(left);
  console.log(`${s.id.padEnd(10)} at ${marks[s.id].toFixed(1)}s`);
}
await pause(600);
await vt("stamp", SCENES.length); await pause(1000); // end stamp
marks.__end = (Date.now() - t0) / 1000;
await ctx.close(); await b.close();
const raw = readdirSync("out/raw").find((f) => f.endsWith(".webm"));
renameSync(`out/raw/${raw}`, "out/raw/demo.webm");
writeFileSync("out/marks.json", JSON.stringify(marks, null, 2));
