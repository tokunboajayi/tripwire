# 05 · Prompt Guide for Claude Code (token-lean)

> **Status Oct 9, 22:45:** every prompt is built and tested, plus stock replay (B3/B4), Alpaca paper mirror (B5), ElevenLabs voice alerts, and the rule-based agent mode. Docker image verified.
> Needs real keys to finish: Auth0 tenant (A7/D6), `python data/fetch_stocks.py` (Alpaca), a live Claude run, an ElevenLabs key, then deploy to Vultr.
> Use the prompts below to *extend* the code, e.g. `Read engine/src/engine.rs. Add <feature> per BUILD_SPEC §x. Minimal diff.`

## Rules
- One prompt = one milestone. Commit after each.
- Always point at the spec section; never paste the spec.
- Append: `Code only. No prose. Minimal diff.`
- Fix loop: paste the error only → `Fix. Minimal diff.`

## P0 · Session header (every new session)
```
Project Tripwire. Source of truth: docs/03_BUILD_SPEC.md. My seat: <Owner|B|C|D>. Only touch my folders unless told. Code only.
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

## Debug prompts
- `Parity test fails on <field> at <date>. Compare Rust vs backtest/v2.py logic and fix Rust. Minimal diff.`
- `SSE drops behind Caddy after 30s. Add keepalive comments every 15s.`
- `LLM timeout freezes loop. Make agent calls non-blocking; engine must never await agents.`
- `Explain this Rust error in 3 lines, then fix: <error>`
