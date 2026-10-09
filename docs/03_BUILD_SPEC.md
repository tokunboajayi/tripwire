# 03 · Build Spec (source of truth)

## 1. Stack
| Layer | Choice |
|---|---|
| Engine + API | **Rust**: axum, tokio, sqlx (SQLite; Postgres/Tiger Data optional), serde, reqwest (rustls), jsonwebtoken, tower-http, uuid, chrono, tracing |
| AI agents | **Python 3.11**: anthropic SDK, pydantic, httpx. `mcp` SDK (FastMCP) for MCP server |
| Backtest | Python (pandas) — `backtest/` is the reference implementation |
| Frontend | **React + Vite + TypeScript + Tailwind**, TradingView **lightweight-charts**, `@auth0/auth0-react` |
| Live updates | Server-Sent Events |
| Auth | Auth0 (users) · internal token (agents → engine) |
| Prices | Alpaca crypto market data (paper keys); fallback Coinbase Exchange public candles |
| Broker | Simulated fills on live prices for every user; **demo account mirrors orders to Alpaca paper** |
| Deploy | Docker Compose on Vultr VM + Caddy (HTTPS); landing on GitHub Pages |

## 2. Repo layout
```
tripwire/
  engine/            Rust: src/{main,config,db,auth,routes/*,market,indicators,regime,brains,sizing,risk,executor,ledger,scheduler,replay,digest,sse}.rs
  agents/            Python: worker.py regime_agent.py thesis_agent.py prompts.py schemas.py cache.py
  mcp/               Python: server.py (read-only tools)
  web/               React app
  backtest/          Python reference + results (already done)
  landing/           GitHub Pages site
  deploy/            Dockerfile.engine Dockerfile.agents docker-compose.yml Caddyfile
  docs/              these docs
  .env.example  README.md  CONTRIBUTING.md
```

## 3. Data model
```sql
users(id PK, auth0_sub UNIQUE, email, created_at)
accounts(id PK, user_id, profile, goal_amount, goal_months, start_cash, cash, status, mirror_alpaca BOOL, limits_json, created_at)
  -- status: active|paused|killed
positions(account_id, symbol, qty, avg_price, brain, stop, high_water, opened_at, thesis_id, PK(account_id,symbol))
orders(id PK, account_id, client_id UNIQUE, symbol, side, qty, status, gate_code, latency_us, fill_price, fee, brain, reason, created_at)
trades(id PK, account_id, symbol, brain, regime, entry, exit, qty, pnl, ret, exit_reason, opened_at, closed_at)
regime_calls(id PK, symbol, ts, det_regime, ai_regime, final_regime, confidence, reason, source) -- source: ai|fallback|override_rejected
theses(id PK, account_id, symbol, reason, invalidation_json, confidence, status, broken_by, created_at)
events(id INTEGER PK, account_id NULL, type, payload_json, ts)   -- feeds SSE + why-log
equity(account_id, ts, equity, PK(account_id,ts))
candles(symbol, tf, ts, o,h,l,c,v, PK(symbol,tf,ts))
settings(key PK, value)  -- global_kill
```

## 4. Engine loop (scheduler.rs) — every 60s
1. **market.rs** pulls latest 1-min bars per symbol; rolls up into a *rolling daily* bar (last 24h) and stores daily candles.
2. **indicators.rs** (per symbol): ATR14, EMA50/200, SMA200, SMA5, ADX14, RSI2, Donchian10/20, vol20, 30-day realized vol, ATR%-rank over 90 days. Must match `backtest/backtest.py` + `v2.py` exactly.
3. **regime.rs** deterministic regime:
   `ATR%rank>0.85 → HIGH_VOL; ADX>25 && c>EMA200 && EMA50>EMA200 → TREND_UP; c<SMA200 → TREND_DOWN; else RANGE`.
4. Read latest **RegimeCall** from agents (≤ 2h old). Accept AI regime unless `REGIME_MISMATCH` (AI says TREND_UP/RANGE while c<SMA200, or HIGH_VOL while rank<0.6) → use deterministic, log `override_rejected`. No call → deterministic (`fallback`).
5. **brains.rs** per account, per symbol with no position:
   - `TREND_UP` & c>EMA50 & EMA50>EMA200 → **TREND**, size = equity × min(maxpos, volTarget/realizedVol), stop = px − 4·ATR, exit when c<EMA50.
   - `RANGE` & RSI2<10 & c>SMA200 → **MR**, size = equity×risk/(3·ATR) capped, stop = px−3·ATR, exit when c>SMA5 or 10 days.
   - `HIGH_VOL` & c>Donchian10 & v>1.5·vol20 & c>EMA50 → **BREAKOUT**, size = equity×risk/(2·ATR) capped, trailing stop = high−2·ATR.
   - `TREND_DOWN` → **SHIELD** (no entries; explain why).
   - Size × agent confidence (0.5–1.0) if a fresh thesis exists.
6. **Stops/exits** checked every tick on latest price (not only daily close) — Rust's split-second job.
7. Each decision → **risk.rs gate** → **executor.rs** → ledger → event (+ why-log text).
8. Mark-to-market → `equity`; daily-loss check → auto-pause.

## 5. Risk gate (risk.rs) — pure function, unit-tested per code
Order of checks, first failure wins: `KILL_SWITCH, PAUSED, SYMBOL_NOT_ALLOWED, STALE_PRICE(>120s), RATE_LIMIT(>6 orders/min/account)`, then buys only: `INSUFFICIENT_CASH, POSITION_CAP, EXPOSURE_CAP, DAILY_LOSS`.
**Sells/exits are never blocked by caps** (only kill switch blocks sells).
`set_limits(current, requested, actor)`: actor=agent → every value must be ≤ current else `LIMIT_LOOSEN_DENIED` (logged, shown red). actor=user → any value ≤ profile max.
Record `latency_us` around the check.

## 6. Executor + ledger
- Idempotent `client_id`. Fill = live price × (1 ± 5 bps), fee 0.25% (config).
- If `mirror_alpaca`, also POST `/v2/orders` to Alpaca paper (`BTC/USD` etc., `time_in_force=gtc`), store Alpaca id; ledger still uses sim fill (keeps all users consistent). Never mark filled from submit alone when mirroring — poll order status.
- Per-account `tokio::Mutex`. FIFO round trips → `trades`.

## 7. Replay mode (replay.rs)
Same engine, fed historical daily candles (crypto 2025–26 crash, or stocks: AAPL, MSFT, NVDA, AMZN, SPY daily bars from Alpaca) at N days/second. Virtual clock; no look-ahead. Used for the "watch it survive 2025" and the stocks demo.

## 8. AI agents (agents/)
**worker.py** loop: every 15 min per symbol → Regime Agent; on every new position → Thesis Agent creates thesis; every 5 min → fetch Alpaca crypto news for held symbols → Thesis Agent verdict.
- **Regime Agent** (Claude Sonnet): input = JSON indicator snapshot + det_regime + last 5 headlines. Output `RegimeCall` via tool-use JSON. Streams tokens → engine `/internal/stream` → SSE (reasoning stream).
- **Thesis Agent** (Claude Haiku): `Thesis` on entry; `Verdict` per headline. `break` & confidence≥0.7 → POST `/internal/exit` (Rust executes; exits always allowed).
- **Digest**: 8pm ET, 2 sentences from day's stats.
- Timeouts 20s; on error → no call (engine falls back). Disk cache keyed by sha256(prompt) for replay reproducibility.

### Prompts (prompts.py)
REGIME:
```
You classify crypto market regime for an automated long-only investor. Use ONLY the snapshot and headlines given.
Regimes: RANGE (calm, mean-reverting), TREND_UP (sustained uptrend), HIGH_VOL (volatility spike), TREND_DOWN (below long-term average; hold cash).
The deterministic classifier says {det}. Agree unless the evidence clearly says otherwise.
Return: regime, brain (MR|TREND|BREAKOUT|SHIELD), confidence 0-1, reason (<=25 words, plain English for a non-expert).
```
THESIS:
```
Write the investment thesis for this entry: why now (from the data), and 2-4 concrete events that would prove it wrong. Plain English. Return reason, invalidation[], confidence 0-1.
```
VERDICT:
```
Given this thesis and ONE new headline, does the headline directly contradict the reason or match an invalidation item? Return verdict hold|break, confidence 0-1, evidence (<=20 words). Default to hold.
```

## 9. API (`/v1`, JSON)
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | /health | — | liveness |
| POST | /accounts | user | `{profile, goal_amount, goal_months, start_cash}` |
| GET | /accounts/me | user | account, limits, equity, goal progress |
| PATCH | /accounts/me/profile | user | change risk slider (limits recalc) |
| POST | /accounts/me/pause · /resume · /kill | user | controls |
| GET | /accounts/me/positions · /trades · /equity?range= | user | data |
| GET | /accounts/me/events?limit= | user | why-log |
| GET | /stream?token= | user | SSE: tick, regime, order, gate_block, thesis, reasoning_token, digest |
| GET | /market/{symbol}/candles?tf= | public | chart |
| GET | /market/regimes | public | current regime + brain per symbol |
| GET | /backtest | public | v2 summary JSON + curve (from backtest/ CSV) |
| POST | /replays | user | start replay `{dataset, speed}` |
| POST | /admin/kill-all | owner | global kill |
| POST | /internal/regime · /internal/thesis · /internal/verdict · /internal/exit · /internal/stream | agents (X-Internal-Token) | agent → engine |

## 10. Frontend (web/)
Routes: `/` landing+login · `/onboard` (slider with live preview of limits, goal, amount) · `/app` dashboard · `/replay` · `/backtest`.
Dashboard: candles with **regime-colored background bands** + entry/exit markers; brain badge per coin; equity + goal progress bar; today's P&L tile; positions table; **why-log feed** (gate blocks red with code + µs); live reasoning panel; risk slider; pause/kill.

## 11. MCP server (mcp/server.py) — read-only
Tools: `get_portfolio`, `get_positions`, `get_recent_trades(n)`, `explain_trade(trade_id)`, `get_regimes`, `get_daily_digest`. Auth via per-user MCP token (created in settings). **No order placement.**

## 12. Security
Agents use internal token only (not exposed publicly; bind /internal to docker network). User JWT verified (RS256, iss, aud, exp). Owner checks on every route. Parameterized SQL. CORS = web origin. Body limit 16KB. Alpaca keys only in engine env. Per-user: 1 account, 1 replay at a time.

## 13. Config / env
```
DATABASE_URL=sqlite://tripwire.db
SYMBOLS=BTC/USD,ETH/USD,SOL/USD        # add any; engine is symbol-agnostic
FEE_BPS=25  SLIP_BPS=5
APCA_API_KEY_ID= APCA_API_SECRET_KEY= APCA_PAPER_URL=https://paper-api.alpaca.markets
AUTH0_DOMAIN= AUTH0_AUDIENCE= VITE_AUTH0_CLIENT_ID=
ANTHROPIC_API_KEY=  INTERNAL_TOKEN=
PUBLIC_ORIGIN=https://<domain>
```

## 14. Acceptance tests
1. Risk gate: every code fires; exits pass caps; agent loosen → denied.
2. **Parity:** Rust indicators/regime/signals == Python reference on the same 2025 daily candles (CSV fixture).
3. Replay of 2025–26 reproduces v2 trade list within rounding.
4. LLM down → engine keeps trading on deterministic regime.
5. Kill switch closes nothing automatically but blocks all new orders within one tick; "flatten" button sells all.
6. New user: sign in → onboard → sees live dashboard < 2 min.
7. Mirror account shows matching Alpaca paper orders.
