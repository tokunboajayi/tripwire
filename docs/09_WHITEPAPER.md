# Vantrel Whitepaper

**An AI trading system whose safety layer the AI cannot override.**
Version 2.0 · October 2026 · Olatokunbo Ajayi (owner), Bryant Awoh, Obinna Ubaniebere, Kelly Awoh
Live demo: https://getwiththeprogram.study · Code: https://github.com/tokunboajayi/tripwire

> Not financial advice. Paper results and backtests do not guarantee future returns. All real-money features described here are built for the owner's own capital only.

---

## 1. Abstract

Vantrel lets a person set a risk level and fund an account. AI then trades for them, switching between three trading strategies ("brains") and a cash-holding Shield as the market changes. Every order passes through a deterministic risk gate written in Rust that the AI cannot override. The AI may tighten limits freely and may loosen them only back toward the user's own ceiling, and only after a measured winning record. Every decision is hash-chained, and the chain head is anchored on Solana, so the track record can be verified rather than trusted.

On real daily prices with fees included, the in-app replay from January 2025 to October 2026 shows **+1.2% for Vantrel against −27.8% for buying and holding** the same assets. The 2022–26 backtest shows a **worst drop of −17% against −76%** for buy-and-hold. Both samples are small (98 trades in the backtest), and the system gives up return in strong bull markets in exchange for drawdown protection.

Version 2 adds three things. A **real-money broker mode** (Alpaca, paper or live) sits behind dollar limits. A **prediction-market arbitrage engine** (Kalshi and Polymarket) runs its own fast loop and buys both sides of the same event when the combined cost is under the $1 payout after fees. A **capital allocator** recommends where each dollar should sit across venues.

## 2. The problem

1. **Investing well is technical and emotional.** Retail investors tend to sell after falls and buy after rises. Missing recoveries and riding drawdowns costs more than fees do.
2. **Existing tools leave a gap:**

| Tool | What it does | What it doesn't |
|---|---|---|
| Brokerage app | Gives you a buy button | No strategy, no risk control |
| Robo-advisor | Rebalances a static allocation | Doesn't react to market regimes |
| Trading bot | Runs one strategy | Breaks when the regime changes; risk controls are often bolted on |
| "AI trader" | Lets a language model decide | The model can talk itself into more risk; there's no hard boundary |

3. **AI makes the last row dangerous.** Language models are persuasive and fallible. Letting one size its own bets without a hard limit is the core risk of AI in finance.

**Vantrel's answer: the AI proposes, Rust decides.**

## 3. Design principles

1. **Hard limits live outside the AI.** The risk gate is pure Rust: deterministic, unit-tested, no network calls, decisions in nanoseconds.
2. **Asymmetric authority.** The AI can always make things safer. To make things riskier it needs evidence, a small step size, and room under a ceiling the human set.
3. **Explain every action.** Every trade, brain switch and blocked order carries a one-line reason a non-expert can read.
4. **Verify, don't trust.** The track record is tamper-evident and publicly anchored.
5. **Degrade safely.** If the AI or the price feed fails, the engine keeps running on deterministic rules, and stale prices block new buys.
6. **Paper before money, small before large.** Every real-money path has a paper rehearsal that uses identical limits.

## 4. Product

- **Onboarding:** a risk slider (conservative, balanced or aggressive), a goal, and $10,000 of paper money.
- **Dashboard:** live BTC/ETH/SOL prices, the brain currently in charge and why, a risk meter showing distance to the auto-pause line, TradingView charts, and a "why-log" of every decision.
- **Replay:** "Watch it survive 2025", a narrated replay of January 2025 to today on real daily prices, Vantrel vs just holding. Narration uses ElevenLabs.
- **Earned-risk demo:** "Ask the AI to raise its risk". Rust refuses with a reason code until the record earns it.
- **Settings:** track-record verification against Solana, voice settings, an MCP connection so Claude Desktop can answer questions about the portfolio (read-only), and the owner-only real-money and arbitrage panels.
- **Sign-in:** guest sign-in (a private random id per browser) or Auth0.

## 5. Architecture

```
               ┌──────────── Web (React + Vite + TradingView charts) ────────────┐
               │  dashboard · replay · backtest · settings · owner panels        │
               └───────────────▲───────────────────────────────┬──────────────────┘
                     SSE stream │                               │ REST (Auth0 / guest)
┌───────────────────────────────┴───────────────────────────────▼──────────────────┐
│ Rust engine (axum, tokio)                                                        │
│  market.rs ─▶ indicators.rs ─▶ regime.rs ─▶ brains.rs ─▶ risk.rs ─▶ ledger.rs     │
│                    ▲ AI regime (accepted unless the data contradicts it)          │
│  scheduler.rs: prices every 10 s, trading tick every 60 s                         │
│  broker.rs:    owner account → Alpaca (paper | live) behind dollar guards         │
│  pm/:          Kalshi + Polymarket arbitrage loop (every 2 s) + allocator         │
│  audit.rs:     SHA-256 hash chain of every decision                               │
└──────▲───────────────────────▲──────────────────────────▲────────────────────────┘
       │ internal token        │                          │
┌──────┴──────────┐   ┌────────┴─────────┐       ┌────────┴────────┐
│ Agents (Python) │   │ MCP servers      │       │ Solana (devnet) │
│ Claude regime + │   │ portfolio Q&A,   │       │ chain head memo │
│ thesis agents   │   │ TradingView eyes │       │ every 5 minutes │
└─────────────────┘   └──────────────────┘       └─────────────────┘
```

**Stack:** Rust (axum, tokio, reqwest, rsa), React/TypeScript/Vite/Tailwind, Python agents, Claude (Anthropic), ElevenLabs, Solana, Auth0, Alpaca, Kalshi, Polymarket, Docker + Caddy, GitHub Actions and Playwright.

## 6. Strategy engine

### 6.1 Data and indicators
The engine uses daily candles for BTC, ETH and SOL (Binance public market data, with an offline fixture fallback). It computes ATR, EMA50/200, SMA5/200, ADX, RSI-2, a 10-day Donchian channel, 20-day average volume, realised volatility, and the percentile rank of ATR%. The Rust indicators are **parity-tested against the Python backtest on 1,700 days of BTC**, so the live engine and the backtest compute the same numbers.

### 6.2 Regime classifier (deterministic)
```
ATR% rank > 0.85                          → HIGH_VOL   (Breakout brain)
ADX > 25 and close > EMA200 and EMA50 > EMA200 → TREND_UP (Trend brain)
close < SMA200                            → TREND_DOWN (Shield: hold cash)
otherwise                                 → RANGE      (Mean-Reversion brain)
```

### 6.3 The brains

| Brain | Entry | Stop | Exit | Sizing |
|---|---|---|---|---|
| Trend | Close > EMA50 > EMA200 | 4 × ATR | Close < EMA50 | Volatility-targeted: cash × min(maxpos, vol_target / realised vol) |
| Mean-Reversion | RSI-2 < 10 and close > SMA200 | 3 × ATR | Close > SMA5, or 10 days | Risk-based: cash × risk / (3 × ATR), capped |
| Breakout | Close > 10-day high, volume > 1.5× average, close > EMA50 | 2 × ATR, trailing | Trailing stop | Risk-based: cash × risk / (2 × ATR), capped |
| Shield | None: holds cash | — | — | 0 |

Each asset trades from its own cash sleeve. A one-hour cooldown follows every exit. The AI's confidence (0.5–1.0) can scale a position down, never above the profile cap.

## 7. The AI layer

- **Regime agent (Claude):** reads market context and proposes a regime with a confidence and a reason. The engine accepts it **unless the data contradicts it**. For example, "trending up" while price is below its 200-day average is rejected with `REGIME_MISMATCH`, and the deterministic regime stands.
- **Thesis agent:** writes an entry thesis and its invalidation conditions. If those conditions occur, it can request an exit. Exits are always allowed, except under a kill switch.
- **Freshness:** an AI call older than two hours is ignored, and the engine falls back to deterministic rules. With no API key, the agents run in rule-based mode.
- **Earned risk:** the AI may request at most +25% on a limit per step. It is granted only if the account has 3+ closed trades in the last 30 days, a win rate of 55% or more, a non-negative P&L today, and stays at or below the user's profile ceiling. Otherwise the request fails with `RISK_NOT_EARNED`, `RISK_STEP_TOO_BIG` or `LIMIT_LOOSEN_DENIED`.

## 8. Risk framework

### 8.1 Profiles

| Profile | Risk/trade | Max position | Vol target | Max exposure | Daily-loss pause |
|---|---|---|---|---|---|
| Conservative | 1% | 50% of sleeve | 25% | 60% | 2% |
| Balanced | 2% | 75% | 40% | 85% | 4% |
| Aggressive | 3% | 100% | 60% | 100% | 6% |

### 8.2 The gate (first failure wins)
`KILL_SWITCH` → `PAUSED` → `SYMBOL_NOT_ALLOWED` → `STALE_PRICE` (over 120 s) → `RATE_LIMIT` → `INSUFFICIENT_CASH` → `POSITION_CAP` → `EXPOSURE_CAP` → `DAILY_LOSS`.
**Sells are blocked only by a kill switch.** Reducing risk is never prevented. Every code is unit-tested, and gate latency is measured in nanoseconds and logged.

### 8.3 Layers of stop
1. Per-position stops (ATR-based).
2. Daily-loss auto-pause per account.
3. Account kill switch and flatten.
4. Global owner kill switch. It also halts real-money and arbitrage activity, and resuming those is a separate, explicit step.

## 9. Trust: the verifiable track record

Every trade, AI decision, block, limit change and arbitrage event is appended to a hash chain: `hash_n = SHA-256(hash_{n-1} | seq | ts | kind | msg)`. Editing any past entry changes every later hash. Every 5 minutes the chain head is written to Solana as a memo transaction. Settings → *Verify the track record* downloads the chain, recomputes it in the browser, and compares it with the on-chain memo. The result reads "Match", or "Mismatch at event #N".

Only the fingerprint goes on-chain, never the trades. That keeps it private and cheap (fractions of a cent). Devnet is used today; mainnet is a configuration change.

## 10. Evidence

### 10.1 Backtest (daily bars, 0.25% fee + 0.05% slippage per side, long-only, BTC/ETH/SOL)

| | Return | Max drawdown | Trades | Win rate | Break-even win rate |
|---|---|---|---|---|---|
| Out-of-sample 2025–26, conservative | **+0.4%** | −8.4% | 29 | 51.7% | 54.7% |
| Out-of-sample 2025–26, aggressive | +1.5% | −17.1% | 29 | 51.7% | 54.7% |
| Buy & hold, same period | **−27.5%** | −63.4% | — | — | — |
| Full 2022–26, conservative | **+17.5%** | **−17.4%** | 98 | 45.9% | 35.9% |
| Full 2022–26, aggressive | +25.9% | −37.4% | 98 | 45.9% | 35.9% |
| Buy & hold, full | +39.0% | **−75.8%** | — | — | — |

Win rate by brain (full period): Breakout 75%, Mean-Reversion 57%, Trend 28%. Trend wins rarely but its winners are large.

### 10.2 Live replay
Running the same engine over January 2025 to October 2026 on real daily prices gives **+1.2% vs −27.8%** for holding.

### 10.3 How to read this, honestly
- **The product is drawdown protection, not outperformance.** Over 2022–26 it kept about 45% of buy-and-hold's gain with about a quarter of the drawdown.
- **The samples are small:** 98 trades in total, 29 out-of-sample. This is directional evidence, not proof.
- **The out-of-sample edge is thin.** The 2025–26 win rate (51.7%) sits *below* its break-even rate (54.7%). The small positive return came mostly from staying in cash during the fall, not from winning trades. The value in that period was avoiding losses.
- **The out-of-sample period isn't pristine.** v1 was viewed on 2025–26 before v2 was chosen. v2's change, volatility targeting, is a standard technique and wasn't tuned to that period.
- **Fees decide everything at higher frequency.** The first version, on 4-hour bars, lost money (BTC −53%), mostly to fees.

## 11. v2: Real-money broker

The owner's account (`MIRROR_USER`) is mirrored to Alpaca, scaled to `BROKER_CAPITAL_USD`. The paper ledger still makes every decision.
- **Orders:** buys are dollar-amount (notional) market orders. Sells close the whole broker position, so the broker can never hold more than the ledger believes, regardless of partial fills or fees. Retries reuse the same client order id, so a duplicate buy is impossible.
- **Dollar guards, on top of the risk gate:**

| Guard | Default |
|---|---|
| Per order | 10% of capital |
| Total deployed | 100% of capital |
| Daily loss | 3% of capital, which halts new buys for the day |
| Orders per day | 20 |

- **Live can't start by accident.** It requires all of the following, or the engine refuses to boot:
  - `LIVE_CONFIRM=real-money`
  - separate live keys (paper keys never count)
  - an explicit capital figure
  - `MIRROR_USER` set, and not a `dev|` account
  - `DEV` not enabled
  - caps no larger than the capital
- **Every minute it syncs:** broker equity, cash and positions, plus a drift warning when the ledger and the broker disagree.
- **Owner panel:** equity, today's P&L, amount deployed, orders today, and each fill with its slippage vs the model price. Buttons: Halt, Resume, Flatten.
- **Paper is a rehearsal:** paper mode applies the same guards against Alpaca's paper account.

## 12. v2: Prediction-market arbitrage

### 12.1 The edge
A binary contract pays $1 if its outcome occurs. Two structures lock in a profit whatever happens:
- **Cross-venue:** buy YES on one venue and NO on the other for the same event. Exactly one pays $1.
- **Outcome group:** on one venue, buy YES on every outcome of a mutually exclusive, exhaustive event. Exactly one pays $1.

If the combined cost plus fees is below $1, the difference is locked in and is paid when the event settles.

### 12.2 Pricing and sizing
- **Kalshi fee per order:** `ceil(0.07 × contracts × P × (1 − P))`, rounded up to the cent. **Polymarket:** a configurable rate in basis points.
- **Kalshi books list bids only.** The YES ask is $1 minus the best NO bid; the NO ask is $1 minus the best YES bid.
- **Size:** the largest whole number of contracts that fits the shallowest leg's depth and the per-set dollar cap. If rounded fees break the edge at that size, the size is halved and retried.
- **A set is taken only if net edge ≥ `PM_MIN_EDGE_BPS`** (default 1.5%).

**Worked example.** Kalshi YES ask 40¢; Polymarket NO ask 52¢; cap $50.
- Unit cost 92¢, so floor(50 / 0.92) = 54 contracts. Cost $49.68.
- Kalshi fee: ceil(0.07 × 54 × 0.4 × 0.6) = $0.91.
- Payout $54, profit **$3.41**, a **6.7% return on capital** until settlement.

### 12.3 Guard
`PM_HALTED` → `POLY_LIVE_UNSUPPORTED` (in live mode) → `COOLDOWN` (per event) → `RATE_LIMIT` (per hour) → `PM_EXPOSURE_CAP` (capital tied up in open sets) → `NO_CASH` (per venue).
Pairs not marked `verified: true` are watched but never traded (`PAIR_UNVERIFIED`). Cash shortfalls are recorded as missed profit per venue, which feeds the allocator.

### 12.4 Execution
- **Paper:** fills at the quoted ask, cash moves per venue, profit is recorded as "locked". Settlement is automatic from Kalshi results: a cross set pays the venue whose leg won, and a group pays when one outcome resolves YES. Polymarket-only sets settle by owner action.
- **Live: Kalshi legs only.** Orders are RSA-PSS-signed, fill-or-kill limit buys at the quoted price, so a leg fills completely at that price or not at all. If a later leg fails after an earlier one filled, the set is no longer hedged: **the engine halts and reports exactly what is held.** It never tries to repair the position itself.
- **Polymarket orders are not implemented on purpose.** They need a wallet-signed integration and confirmed access in the owner's jurisdiction; the global site restricts US users, and a US offering has been rolling out. Until then, Polymarket legs trade in paper only.

### 12.5 Risks specific to arbitrage
1. **Resolution mismatch:** two venues can word "the same" event differently. This is the dominant risk, and only human verification addresses it.
2. **Fill risk:** quotes move. Paper assumes the full ask size is available; live fill-or-kill avoids partial legs but can miss sets.
3. **Capital lock-up:** money is tied up until settlement, which can take weeks, so annualised return depends on time to settlement.
4. **Venue and counterparty risk:** exchange outages, rule changes, and changes in access by jurisdiction.

## 13. Capital allocator

Each venue (crypto broker, Kalshi, Polymarket) is scored by **realised profit plus profit missed for lack of cash**. Target weights follow the scores, using water-filling with a 10% floor and a 60% cap, so no venue is starved or over-concentrated. The allocator outputs **suggested transfers**, for example "Move $350 from crypto to Kalshi", ignoring moves under $25 or within 5% of target.

**It never moves money between brokers itself.** Bank and USDC transfers between venues have no safe automated path and take hours to days. Automating withdrawals would also be the most dangerous capability the system could have.

## 14. Speed and "high-frequency trading"

The arbitrage engine is the fast part of the system: by default every watched order book is re-priced every 2 seconds, and a pass over 9 markets takes about 10–20 ms. In prediction markets speed is where the edge comes from, because price gaps between venues close within seconds to minutes. The planned next step is websocket order-book feeds, so the engine reacts to each book change instead of polling.

**True microsecond HFT is out of reach, and pursuing it would lose money:**
- It requires co-located servers, direct exchange feeds, and fees of a fraction of a basis point.
- Retail crypto fees are about 15–25 bps per side.
- Retail APIs are rate-limited.
- Vantrel's own 4-hour experiment lost money to fees.

The crypto brains therefore stay on daily decisions with a 60-second risk tick; only the arbitrage loop runs fast.

## 15. Engineering quality

**13 automated suites run on every pull request:**

| Suite | Checks |
|---|---|
| Rust unit tests | 28 |
| Web typecheck/build | — |
| TradingView MCP | 65 |
| End-to-end (API, gate, agents, SSE, replay, MCP) | 66 |
| Live price feed + voice | 16 |
| Production-configured sign-in | 12 |
| Real-money broker vs fake Alpaca | 26 |
| Prediction markets vs fake Kalshi/Polymarket (signatures verified with OpenSSL) | 28 |
| Browser tests: journey, reload, voice, narration, Auth0 | 52 |

There is also a Docker build check.

**A bug found by testing.** The 60-second trading tick computed `now − i64::MIN`, which overflows. Release builds wrap silently, so the condition was never true and **the live site's paper accounts had not been trading.** The fix shipped with a regression test, in the same change that adds real money. This is exactly why money paths need end-to-end tests against fake venues before real ones.

## 16. Security

- Keys live only in the server's `.env`. The repo ships blanks. Live broker keys are separate from paper keys.
- Agent routes require an internal token and a private network. The engine refuses to boot with a guessable token outside development.
- Owner-only controls: only `OWNER_USER` or `MIRROR_USER` can see or operate the broker and arbitrage panels.
- **No withdrawal capability anywhere.** Alpaca API keys can't withdraw, and the allocator only suggests.
- Kalshi requests are RSA-PSS signed with a key loaded at boot.
- Deploy hygiene: Caddy for HTTPS, `no-cache` on HTML so clients don't run stale code, and immutable hashed assets.

## 17. Legal and regulatory position

- **Own money only.** Running other people's money through an automated system makes the operator an investment adviser, which requires SEC or state registration. Vantrel v2 is configured and documented for the owner's capital only.
- **Venues:** Alpaca is a US broker-dealer; crypto availability varies by state. Kalshi is a CFTC-regulated exchange, though some states challenge certain contract types. Polymarket's global platform restricts US persons, and its US offering's availability and API access must be confirmed before use. **No geo-evasion is supported.**
- **Tax:** every sale and every settled contract is a taxable event. Brokers issue tax forms, and a CSV export of fills is planned.
- **Public demo:** paper money only.

## 18. Business model and strategy

The strategy is not the moat; strategies are commodities. **The moat is the safety and accountability layer:** a deterministic gate the AI can't override, earned-risk semantics, and a publicly verifiable audit trail. That suggests three paths:

| Path | Description | Upside | Main obstacle |
|---|---|---|---|
| A. Consumer robo-trader | The current product, with real money for users | Large market | Adviser registration, acquisition cost, trust |
| **B. Guardrails for AI agents that move money** | The gate, dollar guards and audit chain as an API/SDK for anyone building trading or payment agents | Agentic finance is growing and every builder needs limits and audit | Finding the first paying builders |
| C. Open strategy league | Public, Solana-verified leaderboard of AI strategies | Cheap growth and content | Making money from it |

**Recommendation:** run A for the owner's own money as the live proof, and build B as the business. Kill criterion: fewer than 3 of 20 interviewed agent builders willing to integrate.

## 19. Competitive landscape

- **Brokerage apps:** execution only.
- **Robo-advisors:** static allocation, no regime awareness.
- **Retail bots:** single strategy, user-configured risk.
- **"AI copilots" for trading:** advice without enforcement.
- **Prediction-market tools:** mostly analytics. Arbitrage scripts exist but rarely include verified-pair gating, fee-exact sizing, fill-or-kill legs and halt-on-broken-hedge.

**Vantrel's distinct combination:** a regime-switching strategy, AI with *bounded* authority, earned risk, a verifiable track record, and owner-grade real-money controls across crypto and prediction markets.

## 20. Risks and limitations (consolidated)

1. **Strategy:** small sample; thin out-of-sample edge; lags bull markets; regime rules can whipsaw.
2. **Model:** AI regime calls can be wrong. The data-contradiction check catches some errors, not all.
3. **Execution:** slippage vs the model; partial fills (mitigated by notional buys and close-all sells); stops live in the engine, so if the server is down nothing exits. **Broker-side stop orders are the top roadmap item.**
4. **Arbitrage:** resolution mismatch, fill risk, capital lock-up, Polymarket legs in paper only.
5. **Operational:** single server; keys on one host; dependence on external APIs (Binance data, Alpaca, Kalshi, Solana RPC).
6. **Regulatory:** venue availability by state, and changing rules for prediction markets.
7. **Behavioural:** scaling too fast after a lucky streak. This is addressed by the roadmap's 2×-per-30-days rule and its stop rules.

## 21. Roadmap

| Phase | What | Gate to the next phase |
|---|---|---|
| 1 | Crypto paper rehearsal through Alpaca paper (2–4 weeks) | ≥14 days, ≥10 fills, median slippage ≤15 bps, no unexplained drift, every control exercised |
| 1b | Prediction-market arbitrage in paper | ≥14 days, ≥20 sets, **every set settled as a win**, edge survives a 1¢ worse fill per leg |
| 2 | Live micro: $200–500 crypto, Kalshi with $20/set | Stop rules: −10% of capital, slippage >25 bps for a week, or unexplained drift → halt |
| 3 | Scale at most 2× per 30 days, on evidence | Same criteria as live, every period |
| 4 | Broker-side stops, websocket feeds, stop exits every 10 s, alerts, startup reconciliation, tax export | — |
| 5 | Guard-as-a-service (path B) | 3 of 20 builders integrate |

## 22. Team

| Name | Role |
|---|---|
| Olatokunbo (AJ) Ajayi | Owner, engine |
| Bryant Awoh | Data and strategy |
| Obinna Ubaniebere | AI agents and MCP |
| Kelly Awoh | Product |

Built at Hacklanta '26 (Fintech track) and continued afterwards.

---

## Appendix A: Configuration reference (selected)

| Variable | Purpose |
|---|---|
| `BROKER` | `off` \| `paper` \| `live`: owner account mirrored to Alpaca |
| `BROKER_CAPITAL_USD`, `LIVE_MAX_*` | Dollar guards for the broker |
| `LIVE_CONFIRM=real-money`, `APCA_LIVE_*` | Required for live broker mode |
| `PM_MODE` | `off` \| `paper` \| `live`: prediction-market arbitrage |
| `PM_PAIRS_FILE` | Watch list: cross-venue pairs and outcome groups, each with `verified` |
| `PM_EVERY_MS`, `PM_MIN_EDGE_BPS`, `PM_MAX_ARB_USD`, `PM_MAX_EXPOSURE_USD`, `PM_MAX_ARBS_PER_HOUR`, `PM_COOLDOWN_S` | Loop speed and guards |
| `KALSHI_KEY_ID`, `KALSHI_PRIVATE_KEY_PATH`, `PM_LIVE_CONFIRM=real-money` | Required for live arbitrage |

## Appendix B: Reason codes

- **Risk gate:** KILL_SWITCH, PAUSED, SYMBOL_NOT_ALLOWED, STALE_PRICE, RATE_LIMIT, INSUFFICIENT_CASH, POSITION_CAP, EXPOSURE_CAP, DAILY_LOSS
- **AI:** REGIME_MISMATCH, LIMIT_LOOSEN_DENIED, RISK_NOT_EARNED, RISK_STEP_TOO_BIG
- **Broker:** LIVE_HALTED, LIVE_NOT_SYNCED, LIVE_DAILY_LOSS, LIVE_DAILY_ORDERS, LIVE_DEPLOYED_CAP, LIVE_NO_CASH, LIVE_TOO_SMALL, LIVE_DRIFT
- **Arbitrage:** PM_HALTED, POLY_LIVE_UNSUPPORTED, COOLDOWN, RATE_LIMIT, PM_EXPOSURE_CAP, NO_CASH, PAIR_UNVERIFIED, LEG_FAILED

## Appendix C: Glossary

- **Regime:** the market's current character (calm, trending, volatile or falling).
- **Brain:** the strategy assigned to a regime.
- **Sleeve:** each asset's own cash pot.
- **Drawdown:** the drop from a peak.
- **Basis point (bp):** 0.01%.
- **Notional order:** an order sized in dollars rather than units.
- **Fill-or-kill:** an order that fills completely immediately or is cancelled.
- **Set:** the group of contracts in one arbitrage that together pay exactly $1 each.
- **Settlement:** the venue declares the outcome and pays winning contracts.
