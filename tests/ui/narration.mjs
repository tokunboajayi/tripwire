// Narrated demo: captions + one voice at a time through the whole 2025 replay; Stop silences it.
import { chromium } from "playwright-core";
const U = process.env.U || "http://localhost:8098", SHOTS = process.env.SHOTS;
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
const results = []; const check = (n, ok, d = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  -> " + d}`); };
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => {
  window.__playing = 0; window.__maxPlaying = 0; window.__lines = [];
  window.Audio = class { constructor() { this.t = null; this.onended = null; }
    play() { window.__playing++; window.__maxPlaying = Math.max(window.__maxPlaying, window.__playing);
      this.t = setTimeout(() => { window.__playing--; this.t = null; this.onended && this.onended(); }, 2500); return Promise.resolve(); }
    pause() { if (this.t) { clearTimeout(this.t); this.t = null; window.__playing--; } } };
});
await ctx.route("**/v1/voice**", (r) => { const u = new URL(r.request().url()); return r.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from("ID3" + u.searchParams.get("text")) }); });
await ctx.route("**/v1/config", async (r) => { const res = await r.fetch(); r.fulfill({ response: res, json: { ...(await res.json()), voice: true } }); });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
p.on("request", (rq) => { if (rq.url().includes("/v1/voice")) p.evaluate((t) => window.__lines.push(t), new URL(rq.url()).searchParams.get("text")).catch(() => {}); });
await p.goto(U + "/"); await p.waitForSelector("#nm1");
await p.locator("#nm1").pressSequentially("Narrator", { delay: 30 }); await p.click("#nm1 ~ button");
await p.click("text=Continue"); await p.click("text=Continue"); await p.click("text=Fund & start trading");
await p.waitForSelector("text=Watch it survive 2025", { timeout: 15000 });
await p.click("text=Watch it survive 2025"); await p.waitForTimeout(3500);
const cap = async () => (await p.locator("[data-caption] [aria-live=polite]").innerText().catch(() => "")).trim();
check("intro caption appears and is spoken", /2025, replayed/.test(await cap()) && (await p.evaluate(() => window.__lines[0] || "")).startsWith("2025, replayed"), await cap());
if (SHOTS) await p.screenshot({ path: SHOTS + "/80-narration-intro.png" });
await p.waitForTimeout(12000);
const lines = await p.evaluate(() => window.__lines);
check("brain-switch lines are narrated as the year plays", lines.some((l) => /(turns down|trending up|volatility spikes|goes quiet)/.test(l)), JSON.stringify(lines));
if (SHOTS) await p.screenshot({ path: SHOTS + "/81-narration-mid.png" });
check("never more than one voice at once", (await p.evaluate(() => window.__maxPlaying)) === 1, await p.evaluate(() => window.__maxPlaying));
await p.waitForSelector("text=Replay again", { timeout: 120000 }); await p.waitForTimeout(3500);
check("outro states the final score", /^Done\. Vantrel finished (up|down) [\d.]+ percent\. Just holding: (up|down)/.test(await cap()), await cap());
if (SHOTS) await p.screenshot({ path: SHOTS + "/82-narration-outro.png" });
await p.click("text=Replay again"); await p.waitForTimeout(2500);
check("replay again restarts the narration", /2025, replayed/.test(await cap()), await cap());
await p.click("text=Stop and go live"); await p.waitForTimeout(800);
check("Stop silences the voice", (await p.evaluate(() => window.__playing)) === 0, await p.evaluate(() => window.__playing));
check("Stop removes the caption", (await p.locator("[data-caption]").count()) === 0);
check("no JavaScript errors", errs.length === 0, JSON.stringify(errs));
await b.close(); console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
