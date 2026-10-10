# 01 · Tripwire — The Idea (plain version)

## One line
**Set your risk. Fund it. AI trades for you — switching between 3 trading "brains" to match the market, with a Rust safety layer it can't override.**

## The problem (say this first)
Most people can't invest well. It's technical (what/when to buy and sell) and emotional (panic-selling bottoms, buying tops).
The tools force a bad choice:
- **Do it yourself** (Robinhood, Webull): you get a buy button and your own fear and greed.
- **Robo-advisors** (Acorns, Betterment, Wealthfront): safe, but passive. Index funds on autopilot; they never react to the market.
- **Trading bots**: one strategy run blindly into every market. They blow up when conditions change.

**Gap:** nothing actively trades for a regular person, adapts to the market, controls risk, and explains itself.

## The product
1. **Onboard (60 sec):** risk slider (Conservative / Balanced / Aggressive) → goal (e.g. "grow $5k, 12 months") → paper-fund amount.
2. **AI runs everything:** reads the market, picks the brain, sizes, enters, exits, manages stops.
3. **You watch:** live chart, positions, daily gain/loss, goal progress, and a plain-English "why" for every action.

## First-of-its-kind claim (defensible wording)
> "Every human trader is stuck with one strategy. Tripwire is the first consumer AI investor that switches between multiple trading brains in real time to fit the market — and it physically can't override your risk limits."

Do NOT say "first AI trader ever." Say: *institutional ideas (regime switching, hard risk gates) made as simple as a slider.*

## The 3 brains + the router
| Market regime (how it's detected) | Brain | Behavior | Backtest win rate* |
|---|---|---|---|
| **Calm / range** (low ADX, above 200-day avg) | **Mean-Reversion** | Buy sharp dips, sell the bounce | 57% (69% out-of-sample) |
| **Trending up** (ADX>25, 50>200 EMA) | **Trend** | Ride it, size by volatility, exit below 50-EMA | 28% — but winners are huge |
| **High volatility** (ATR in top 15% of last 90 days) | **Breakout** | Buy confirmed volume breakouts, tight trailing stop | 75% |
| **Downtrend** (below 200-day avg) | **Shield** | Hold cash, wait for regime change | — (this is why drawdown stays small) |

\*BTC/ETH/SOL daily bars, 2022–2026, 0.25% fees. See `02_BACKTEST.md`.

**Honest note on "always trading":** spot crypto on Alpaca is long-only (no shorting). In a downtrend the only real defense is cash. Shield *is* a strategy — it's the reason Tripwire lost ~0% while the market lost 27.5%.

## The two AI agents (judgment only) + Rust (everything fast)
| Part | Job | Why it's AI or Rust |
|---|---|---|
| **Regime Agent** (LLM) | Reads indicator snapshot + headlines → picks regime/brain + 1-line reason + confidence | Judgment call |
| **Thesis Agent** (LLM) | On entry writes *why* + *what would prove it wrong*; reads news; flags "thesis broken" | Judgment call |
| **Rust engine** | Indicators, signals, sizing, stops, risk gate, execution, ledger | Math must be microseconds and deterministic |

**Rule:** AI chooses, Rust verifies. If the LLM is slow, errors, or picks a regime the data contradicts, Rust falls back to the deterministic regime. The demo never freezes.

## Signature demo moments (build these on purpose)
1. **Brain switch live:** chart shades by regime; banner "Switched to Breakout brain — volatility spiked."
2. **Why-log:** every action has one sentence ("Bought ETH: calm market, oversold, target +2.4%, stop −3.1%").
3. **Risk slider changes behavior live:** drag Conservative → Aggressive; position sizes + limits update on screen.
4. **AI can't loosen limits:** agent asks for bigger size after a loss → Rust blocks: `LIMIT_LOOSEN_DENIED`.
5. **Confidence sizing:** agent confidence 0.5–1.0 scales size (never above the profile cap).
6. **Goal progress + daily digest:** "Today +0.8%, 2 trades, 1 win. Goal: 34% of the way."
7. **Live reasoning stream:** the Regime Agent's thinking streams token-by-token on screen.
8. **Verified on Solana:** every action is hash-chained and anchored on Solana; anyone can verify the history in their browser.
9. **Talk to your portfolio (MCP):** ask Claude "why did you sell ETH?" → answer from Tripwire data.

## Vs. who
| | Robinhood | Acorns / robo | Bots | **Tripwire** |
|---|---|---|---|---|
| Who decides | You | Fixed index mix | 1 fixed rule | AI, per market regime |
| Adapts to market | You do | No | No | **Yes, 3 brains + shield** |
| Hard risk layer AI can't override | No | n/a | Rare | **Yes (Rust)** |
| Explains each action | No | No | No | **Yes** |

## Classifications (shared vocabulary for the team)
- **Risk profiles** — `conservative` · `balanced` · `aggressive`
- **Regimes** — `RANGE` · `TREND_UP` · `HIGH_VOL` · `TREND_DOWN`
- **Brains** — `MR` · `TREND` · `BREAKOUT` · `SHIELD`
- **Order status** — `proposed → approved|rejected → filled|failed`
- **Risk-gate codes** — `OK`, `KILL_SWITCH`, `PAUSED`, `SYMBOL_NOT_ALLOWED`, `STALE_PRICE`, `RATE_LIMIT`, `INSUFFICIENT_CASH`, `POSITION_CAP`, `EXPOSURE_CAP`, `DAILY_LOSS`, `LIMIT_LOOSEN_DENIED`, `REGIME_MISMATCH`
- **Agent outputs** — `RegimeCall{regime, brain, confidence, reason}` · `Thesis{symbol, reason, invalidation[], confidence}` · `Verdict{hold|break, confidence, evidence}`
- **Modes** — `live` (real-time prices, paper money) · `replay` (historical data, sped up)

## Profile limits (AI may tighten, never loosen)
| | Conservative | Balanced | Aggressive |
|---|---|---|---|
| Risk per MR/Breakout trade | 1% | 2% | 3% |
| Trend sleeve vol target | 25% | 40% | 60% |
| Max per-asset position | 50% | 75% | 100% |
| Max total exposure | 60% | 85% | 100% |
| Daily loss → auto-pause | 2% | 4% | 6% |

## Never claim
Guaranteed returns, "beats the market," "first AI trader ever." Claim: adapts, protects, explains — and show the backtest.
