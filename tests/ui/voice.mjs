// Voice plays one line at a time: clicking again mid-speech stops it; it never stacks a second voice.
import { chromium } from "playwright-core";
const U = process.env.U || "http://localhost:8098";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
const results = []; const check = (n, ok, d = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  -> " + d}`); };
const ctx = await b.newContext();
await ctx.addInitScript(() => { // fake 4s clip; count how many play at once
  window.__playing = 0; window.__maxPlaying = 0; window.__started = 0;
  window.Audio = class { constructor() { this.t = null; this.onended = null; }
    play() { window.__started++; window.__playing++; window.__maxPlaying = Math.max(window.__maxPlaying, window.__playing);
      this.t = setTimeout(() => { window.__playing--; this.t = null; this.onended && this.onended(); }, 4000); return Promise.resolve(); }
    pause() { if (this.t) { clearTimeout(this.t); this.t = null; window.__playing--; } } };
});
await ctx.route("**/v1/voice**", (r) => r.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from("ID3fake") }));
await ctx.route("**/v1/config", async (r) => { const res = await r.fetch(); const j = await res.json(); r.fulfill({ response: res, json: { ...j, voice: true } }); });
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(U + "/"); await p.waitForSelector("#nm1");
await p.locator("#nm1").pressSequentially("Voice", { delay: 30 }); await p.click("#nm1 ~ button");
await p.click("text=Continue"); await p.click("text=Continue"); await p.click("text=Fund & start trading");
await p.waitForSelector("text=Hear today's report", { timeout: 15000 });
await p.click("text=Hear today's report"); await p.waitForTimeout(800);
check("first click plays and the button turns into Stop", (await p.evaluate(() => window.__playing)) === 1 && (await p.locator("button:has-text('Stop')").count()) === 1);
await p.click("button:has-text('Stop')"); await p.waitForTimeout(300);
check("second click mid-speech stops it (no second voice)", (await p.evaluate(() => [window.__playing, window.__maxPlaying])).join() === "0,1", JSON.stringify(await p.evaluate(() => [window.__playing, window.__maxPlaying])));
check("button is back to 'Hear today's report'", (await p.locator("text=Hear today's report").count()) === 1);
for (let i = 0; i < 4; i++) { await p.click("button:has-text('Hear today'), button:has-text('Stop')"); await p.waitForTimeout(120); } // frantic clicking
await p.waitForTimeout(800);
check("frantic clicking never stacks voices", (await p.evaluate(() => window.__maxPlaying)) === 1, await p.evaluate(() => window.__maxPlaying));
await p.goto(U + "/settings"); await p.waitForTimeout(800);
check("leaving the dashboard ends the report", (await p.evaluate(() => window.__playing)) === 0);
const test = p.getByRole("button", { name: "Test", exact: true }); await test.waitFor();
await test.click(); await p.waitForTimeout(400); await test.click(); await p.waitForTimeout(600);
const st = await p.evaluate(() => [window.__started, window.__maxPlaying, window.__playing]); check("Settings Test twice: still one voice", st[1] === 1, JSON.stringify(st) + " " + (await p.locator("section:has-text(\"Voice alerts\")").innerText().catch(() => "no voice section")));
check("no JavaScript errors", errs.length === 0, JSON.stringify(errs));
await b.close(); console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
