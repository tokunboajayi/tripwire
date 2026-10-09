# 04 · Build Plan (team of 4, layered)

## Team & seats (Hacklanta max = 4)
| Seat | Person | Owns | Folders |
|---|---|---|---|
| **Owner · Integrator + Engine** | AJ @tokunboajayi (head of uploads) | repo admin, merges every PR, releases, deploy, Rust engine | `engine/`, `deploy/`, root files |
| **B · Data & Strategy** | Bryant @Bawoh1 | market data pipeline, backtest, Rust↔Python parity fixtures, replay datasets (crypto + stocks), Tiger Data (opt) | `data/`, `backtest/` |
| **C · AI & MCP** | Ebere @ubaniebereo | **MCP server ("talk to your portfolio")**, Regime + Thesis agents, prompts, reasoning stream, digest | `mcp/`, `agents/` |
| **D · Product** | Kelly @kellyawoh-jpg | React dashboard, onboarding, Auth0, landing page, deck | `web/`, `landing/` |

Interfaces are fixed in `03_BUILD_SPEC.md §9`. Agree at H0, then build in parallel against mocks.

## Layers — each one is a complete demo
| Layer | Delivers | Done when |
|---|---|---|
| **1 · Floor** | Live BTC/ETH/SOL prices → deterministic regime → 3 brains + shield → risk gate → sim fills → dashboard with chart, positions, P&L, why-log | one account trades on live prices, shown in browser |
| **2 · The brain** | Regime Agent + Thesis Agent, AI-vs-deterministic check, fallback, regime bands on chart, brain-switch banner, confidence sizing, `LIMIT_LOOSEN_DENIED` demo | brain switch visible; LLM off → still trades |
| **3 · Platform** | Auth0 sign-in, onboarding slider (live limit preview), goal progress, daily digest, **backtest page** (v2 curve), **replay** (2025 crash + stocks), Alpaca paper mirror, deploy + domain | stranger signs up on public URL |
| **4 · Cutting edge** | Live reasoning stream, MCP "talk to your portfolio", ElevenLabs voice alerts, more coins | demo-able in 20s each |

## Hour map (H0 = kickoff; ~34h of build)
| Hours | Owner · Engine | B · Data | C · AI & MCP | D · Product |
|---|---|---|---|---|
| 0–2 | scaffold, DB, /health | export 2025 daily candles + expected signals CSV (parity fixture) | agents scaffold, schemas, prompts | Vite app, layout, mock API |
| 2–8 | market feed, indicators, regime, brains | parity test harness | Regime Agent w/ cache | chart + regime bands + positions (mock) |
| 8–12 | risk gate + tests, executor, ledger, SSE | parity passes; replay engine | Thesis Agent + news | why-log feed, P&L tiles on SSE |
| **12** | **Checkpoint 1: Layer 1 live end-to-end. If not, everyone swarms it.** ||||
| 12–18 | /internal routes, AI acceptance + fallback, confidence sizing | Alpaca mirror; stock replay dataset | wire agents → engine; reasoning stream | onboarding slider, brain banner |
| 18–24 | profile limits, pause/kill, digest stats | backtest page data, replay UI support | digest, MCP server | Auth0, goal progress, backtest page |
| **24** | **Checkpoint 2: Layers 2+3 on laptop. Deploy starts.** ||||
| 24–28 | Docker + Vultr + Caddy | QA replays | ElevenLabs (opt) | landing page (GitHub Pages) |
| 28–30 | **Feature freeze.** Bugs only. ||||
| 30–32 | 3 full demo runs, record backup video | | | Devpost write-up, deck |
| 32–34 | sleep in shifts (2 at a time) ||||
| 34–36 | rehearse pitch ×3, submit ||||

## Cut order (cut from the top)
1. ElevenLabs → 2. MCP → 3. Stock replay → 4. Alpaca mirror → 5. Auth0 (dev login) → 6. Deploy (laptop demo)
**Never cut:** live engine, 3 brains + shield, risk gate, why-log, AI regime + fallback, backtest page.

## Demo script (3 min)
1. **Problem (25s):** "Most people can't invest well — it's technical and emotional. Robinhood gives you a button and your own panic. Acorns parks your money and never reacts. Bots run one strategy until it blows up."
2. **Onboard (20s):** slide to Balanced, goal $5k/12 months, fund paper $10k.
3. **Live (60s):** dashboard on live crypto. Point at regime bands: "Calm → Mean-Reversion brain. Volatility spikes → it switches to Breakout." Why-log line. Reasoning stream.
4. **Safety (25s):** trigger agent "raise my size after a loss" → red `LIMIT_LOOSEN_DENIED`, 0.2ms. Drag slider to Conservative → limits shrink live.
5. **Proof (30s):** backtest page. "2025–26: crypto −27.5%. Tripwire +0.4% to +1.5%, a quarter of the drawdown. Every fee included. Small sample — we say so."
6. **Close (20s):** "AI chooses the brain. Rust enforces your limits. You just watch. I ran my own autonomous trading desk and learned a high win rate can still lose money — Tripwire is built on that lesson."

## Judge Q&A
- **Does it beat the market?** In bull runs, no — it trades upside for a much smaller drawdown. In the 2025–26 decline it stayed flat-to-green.
- **Is the backtest overfit?** Three versions, all shown, standard techniques, 2025–26 held out. Small sample; we say so.
- **Why not shorting?** Spot crypto on Alpaca is long-only. Downtrend = Shield (cash).
- **Why Rust?** Stops and risk checks are math that must be fast and deterministic. The AI can't touch that code path.
- **Why LLMs at all?** Regime calls with news context and plain-English explanations. If the LLM fails, the deterministic engine keeps going.
- **Real money?** Paper today. Real money needs a broker partner and adviser registration — that's the roadmap, not a weekend.
- **Business:** free paper tier → premium live tier via broker partnership; B2B white-label for brokerages adding AI investing.
