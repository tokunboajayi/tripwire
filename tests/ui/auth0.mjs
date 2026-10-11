// Auth0 build where Auth0 rejects the login (the live-site failure): the page must say why and still let people in as guests.
import { chromium } from "playwright-core";
const U = process.env.U || "http://localhost:8098";
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
const results = []; const check = (n, ok, d = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  -> " + d}`); };
const p = await b.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.route(/auth0\.com/, (r) => r.abort()); // no real tenant in tests
const err = encodeURIComponent('Client "8eKrAVG2an5ZL9AXmqGPHYNFbYn4KDOf" is not authorized to access resource server "https://api.vantrel".');
await p.goto(`${U}/?error=invalid_request&error_description=${err}`); await p.waitForTimeout(3000);
const alert = (await p.locator("[role=alert]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
check("Auth0 error is shown, with the dashboard fix", /Auth0 refused the sign-in/.test(alert) && /Application Access/.test(alert), alert);
check("error is cleaned out of the address bar", !p.url().includes("error="), p.url());
check("guest sign-in is offered", (await p.locator("#nm1").count()) > 0);
await p.locator("#nm1").pressSequentially("Judge", { delay: 40 }); await p.click("#nm1 ~ button"); await p.waitForTimeout(2500);
check("guest gets past Get started -> onboarding", (await p.locator("text=How much risk").count()) > 0, (await p.locator("body").innerText()).slice(0, 120));
await p.click("text=Continue"); await p.click("text=Continue"); await p.click("text=Fund & start trading");
await p.waitForURL("**/app", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2000);
check("guest reaches the dashboard", (await p.locator("text=Portfolio value").count()) > 0);
await p.reload(); await p.waitForTimeout(3000);
check("guest stays signed in after reload (Auth0 build)", (await p.locator("text=Portfolio value").count()) > 0, (await p.locator("body").innerText()).slice(0, 120));
await p.goto(U + "/settings"); await p.waitForSelector("text=Sign out"); await p.click("text=Sign out"); await p.waitForTimeout(1500);
check("guest sign out stays on this site (no Auth0 redirect)", p.url().startsWith(U), p.url());
const q = await b.newPage(); await q.route(/auth0\.com/, (r) => r.abort()); await q.goto(U + "/"); await q.waitForTimeout(2500);
check("no error: Auth0 Get started + guest option both shown", (await q.locator("button:has-text('Get started')").count()) >= 1 && (await q.locator("#nm1").count()) > 0);
check("no JavaScript errors", errs.length === 0, JSON.stringify(errs));
await b.close(); console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
