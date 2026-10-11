# 05 · Prompt Guide for Claude Code (token-lean)

> **Oct 11:** live-site bugs fixed and covered by tests in CI; see **F · Fix prompts** below. Open items are dashboard and server settings, not code.
> **Status Oct 9, 22:45:** every prompt is built and tested, plus stock replay (B3/B4), Alpaca paper mirror (B5), ElevenLabs voice alerts, and the rule-based agent mode. Docker image verified.
> **Status Oct 11:** F1–F9 fixes merged (guest sign-in, earned risk, single voice, narrated replay, cache headers). Final demo video in `demo/`. Full suite (cargo, web build, tv-mcp, e2e, live feed, public sign-in, Playwright UI incl. Auth0 mode) green in CI.
> Needs real keys to finish: Auth0 tenant (A7/D6), `python data/fetch_stocks.py` (Alpaca), a live Claude run, an ElevenLabs key, then deploy to Vultr.
> Use the prompts below to *extend* the code, e.g. `Read engine/src/<module>.rs. Add <feature> per BUILD_SPEC §x. Minimal diff.` (modules follow §2: indicators, regime, brains, risk, ledger, scheduler, routes/…)

## Rules
- One prompt = one milestone. Commit after each.
- Always point at the spec section; never paste the spec.
- Append: `Code only. No prose. Minimal diff.`
- Fix loop: paste the error only → `Fix. Minimal diff.`
- Live bug: `Reproduce on a production-configured engine first, then fix, then add the check to CI.`

## P0 · Session header (every new session)
```
Project Vantrel. Source of truth: docs/03_BUILD_SPEC.md. My seat: <Owner|B|C|D>. Only touch my folders unless told. Code only.
```

## Owner · Engine
**A1** `Scaffold engine/ per §1–3: Cargo.toml, main.rs (/v1/health), config.rs (env §13), db.rs (sqlx sqlite, migrations from §3).`
**A2** `Implement market.rs (Alpaca crypto latest bars, Coinbase fallback) + indicators.rs + regime.rs per §4 steps 1–3. Unit test indicators against backtest/fixtures/*.csv.`
**A3** `Implement risk.rs per §5 as a pure fn + set_limits. Table-driven tests for every gate code; exits pass caps; agent loosen denied.`
**A4** `Implement brains.rs, sizing, executor.rs, ledger.rs, scheduler.rs per §4 steps 5–8 and §6. Emit events with a one-sentence why string.`
**A5** `Implement routes §9 (user + public) and SSE /stream. Dev auth via X-Dev-User when DEV=1.`
**A6** `Implement /internal routes, AI regime acceptance + REGIME_MISMATCH + fallback (§4 step 4), confidence sizing.`
**A7** `Auth0 JWT verification (RS256, JWKS cache), owner checks. Docker + compose + Caddy per §1.`

## B · Data & Strategy
**B1** `From backtest/v2.py, export fixtures: 2025-26 daily candles for BTC/ETH/SOL + per-bar indicators, regime, entry/exit signals as CSV in backtest/fixtures/.`
**B2** `Write engine/tests/parity.rs that runs Rust indicators/regime/brains on fixtures and asserts equality (tolerance 1e-6).`
**B3** `Implement replay.rs per §7 (virtual clock, speed, no look-ahead) and POST /replays.`
**B4** `Fetch Alpaca daily bars 2024-01..2025-12 for AAPL,MSFT,NVDA,AMZN,SPY into replays/stocks.json.`
**B5** `Alpaca paper mirror per §6 (submit, poll status, store id). Only for accounts with mirror_alpaca.`

## C · AI & MCP (start with C5 — MCP is this seat's headline)
**C1** `Scaffold agents/: schemas.py (RegimeCall, Thesis, Verdict pydantic), prompts.py (§8 text), cache.py (sha256 disk cache), worker.py loop per §8.`
**C2** `regime_agent.py: Claude Sonnet, tool-use JSON output, 20s timeout, stream tokens to /internal/stream, POST result to /internal/regime.`
**C3** `thesis_agent.py: Claude Haiku. Thesis on new position, Verdict per Alpaca crypto news headline; break & conf>=0.7 → /internal/exit.`
**C4** `Daily digest at 20:00 ET → 2 sentences → /internal/digest.`
**C5** `mcp/server.py with FastMCP: read-only tools in §11 calling engine API with user MCP token. README snippet for Claude Desktop config.`

## D · Product
**D1** `Vite+React+TS+Tailwind app in web/. Routes §10. API client + SSE hook. Mock data mode.`
**D2** `Dashboard: lightweight-charts candles with regime background bands + entry/exit markers, brain badges, positions, P&L tiles, equity + goal progress.`
**D3** `Why-log feed (gate blocks red with code + µs), live reasoning panel (reasoning_token events), brain-switch banner.`
**D4** `Onboarding: risk slider with live preview of limits table (from 01_IDEA profile table), goal, amount → POST /accounts.`
**D5** `Backtest page from GET /backtest: v2 curve vs buy & hold, table, caveats text. Replay page.`
**D6** `Auth0 React SDK login/logout; attach token to fetch; SSE token in query.`

## F · Fix prompts (live-site bugs, Oct 11)
Each prompt states the symptom, the cause and the fix; then prove it with the test named. Rule: reproduce on a **production-configured engine** (no `DEV`, real `INTERNAL_TOKEN`) before fixing, and add the check to CI so it can't come back.

**F1 · Spinner forever** `"Loading your portfolio…" never ends. web/src/App.tsx load() only handles 404. Show the real error with Retry (auto every 5s); 401 → sign-in screen; refresh Auth0 token once on 401; 15s fetch timeout. Verify: kill the engine → error screen; restart → recovers without reload.`
**F2 · "Session expired" on Get started** `Name sign-in sends dev:<name>, which a public engine (DEV unset) rejects. Add guest ids guest:<name>.<16+ hex> (key made in the browser, never typed): engine auth.rs + config GUEST_SIGNIN (default on, also next to Auth0); /v1/config reports guest + signin. Old saved names upgrade themselves. Verify: tests/public_signin.py.`
**F3 · Name box loses focus after each letter** `Landing's sign-up form is an inline component re-created every render. Render it in place ({start()} not <Start/>). Verify: tests/ui/journey.mjs types one key at a time.`
**F4 · Wrong page after refresh / deep link** `navigate() runs during render before usePath listens. Redirect in an effect only once sign-in is known; usePath re-syncs on mount. Verify: refresh on /settings and /replay stays put; sign out → same name → portfolio back.`
**F5 · Get started "reloads" the page** `It's Get started → 401 → "Sign in again" → start page, from a web/engine mismatch. Page must detect an older engine (no guest in /v1/config) and say "redeploy with --build"; a refused name sign-in quotes the engine's reason; a failed config fetch says "can't reach the server" and retries (never "outdated"). Verify: tests/ui/reload.mjs (click, Enter, bottom form, iPhone tap, Android Go).`
**F6 · Auth0 loop: back to landing with ?error=…** `Read error/error_description from the redirect and useAuth0().error; show "Auth0 refused the sign-in: …" with the dashboard fix; clean the URL; offer guest sign-in beside Auth0; guest Sign out must not redirect to Auth0. Verify: tests/ui/auth0.mjs (Auth0-mode build, rejected login).`
**F7 · Old page after every deploy** `index.html has no Cache-Control so browsers keep the last release. Engine: no-cache for the page and SPA routes, immutable for /assets/*. Verify: e2e cache checks; curl -I / shows no-cache.`
**F8 · "Let the AI raise its risk" always blocked** `Agents could only tighten, so after tightening they never earned risk back. risk::agent_limits: never above the user's profile (LIMIT_LOOSEN_DENIED); below it only when earned (3+ trades/30d, 55%+ wins, not losing today: RISK_NOT_EARNED); ≤ +25% per step (RISK_STEP_TOO_BIG). Button explains the result. Verify: risk unit tests + e2e codes.`
**F9 · Voice fails silently** `speak() swallows errors; engine returns a bare 502. Surface ElevenLabs' own status/message, add Settings → Test, cut text at a sentence (600 chars), ELEVENLABS_MODEL default eleven_flash_v2_5. Verify: tests/live_feed.py error path.`

**Not code (do in a dashboard / on the server):**
- **Auth0:** APIs → the API matching `AUTH0_AUDIENCE` → Application Access → authorize the SPA for user access. App settings: type SPA; Allowed Callback, Logout and Web Origins = the site URL. No client secret in `.env`. `VITE_*` changes need `--build`.
- **Deploy:** `docker compose --env-file .env -f deploy/docker-compose.yml --profile https up -d --build`, then check `/v1/config` shows `"guest":true`.
- **ElevenLabs:** Settings → Test. `detected_unusual_activity` = free plan blocked from a server IP; needs a paid plan.
- **Claude:** set `ANTHROPIC_API_KEY` on the server, or the "AI picks the brain" story is rule-based only.

**Release check (before every demo):** `Run tests/ui/journey.mjs, reload.mjs and auth0.mjs against a production-configured engine, then on the live site: InPrivate window → guest sign-up → fund → refresh → Watch it survive 2025 to the end → Settings → Test voice. Report pass/fail per step.`

## Debug prompts
- `Parity test fails on <field> at <date>. Compare Rust vs backtest/v2.py logic and fix Rust. Minimal diff.`
- `SSE drops behind Caddy after 30s. Add keepalive comments every 15s.`
- `LLM timeout freezes loop. Make agent calls non-blocking; engine must never await agents.`
- `Explain this Rust error in 3 lines, then fix: <error>`
