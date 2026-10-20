# Vantrel: Roadmap to trading your own money

**Goal:** run Vantrel on a small amount of my own money, prove it with real fills, then scale only as fast as the evidence allows.
**Rule:** the paper ledger decides, Rust caps every real dollar, and anything unexpected halts new buys. Exits always go through.

## Where we are

| Done | What |
|---|---|
| ✅ | **Broker mode** `BROKER=off\|paper\|live` (`engine/src/broker.rs`). The owner account's decisions are sent to Alpaca, scaled to `BROKER_CAPITAL_USD`. |
| ✅ | **Dollar guards in Rust**, on top of the risk gate: per-order cap, total deployed cap, daily dollar-loss halt, orders-per-day cap. The same caps run in paper mode, so paper is an exact rehearsal. |
| ✅ | **Live can't start by accident:** it needs `LIVE_CONFIRM=real-money`, its own keys (`APCA_LIVE_*`, separate from the paper keys), a capital figure and `MIRROR_USER`. It refuses `DEV=1`, and it refuses caps above the capital. |
| ✅ | **Owner controls:** Settings → Broker shows broker equity, today's P&L, deployed, orders, fills with slippage vs the model, and Halt / Resume / Flatten. The global kill switch also halts real money; resuming is a separate, explicit step. |
| ✅ | **Sync and drift:** every minute it pulls broker equity and positions, enforces the daily loss, and warns when the ledger and the broker disagree. |
| ✅ | **Prediction-market arbitrage** (`engine/src/pm/`): Kalshi + Polymarket, its own fast loop (default every 2 s). Buys both sides of the same event when the total is under the $1 payout after fees (cross-venue pairs, and outcome groups on one venue). It only trades pairs you have verified, works within a per-set cap, an exposure cap, a rate limit and a cooldown, settles automatically from Kalshi, and its events go into the audit chain. Live mode covers Kalshi legs only: orders are signed fill-or-kill, and a failed leg halts everything. |
| ✅ | **Capital allocator:** scores each venue (crypto, Kalshi, Polymarket) by profit made plus profit missed for lack of cash, then suggests transfers. It never moves money between brokers itself. |
| ✅ | **Growth Ladder** (`engine/src/ladder.rs`, Settings → Growth Ladder): live capital is capped at what you have earned. It starts at `LADDER_START_USD` (default $200) and goes up only by an owner raise, at most 2× per 30 days, and only when all 8 checks pass: days on the rung, days since the last raise, fills, median slippage, drawdown, return, no daily-loss halts, ledger matching the broker. A 10% drop from the peak halts buys. Projections use the measured return plus your monthly contribution, and deposits don't count as profit. |
| ✅ | **Trend Core strategy** (`brains.rs`, picker on the dashboard and in onboarding): hold each coin above its 100-day average, cash otherwise. Backtest: `docs/02_BACKTEST.md`. Replays use the account's strategy. |
| ✅ | **Fast exits:** stops and exits are checked on every price refresh (every 10 s) instead of every 60 s. Entries stay on the 60 s tick. |
| ✅ | **Ladder stop at 25%** (was 10%), and the drawdown check clears at a new high. The 10% line froze rungs for good in `backtest/ladder_sim.py`. |
| ✅ | **Bug fixed:** the 60-second trading tick never fired in release builds (`now() - i64::MIN` overflowed and wrapped). Paper accounts on the live site had not been trading. Covered by `tests/live_broker.py`. |

## Phase 1: Paper rehearsal (2–4 weeks, starting now)

**Setup (server `.env`):**
```
MIRROR_USER=<your user id>   # Auth0 sub, e.g. auth0|abc123; guest ids work but Auth0 is safer
BROKER=paper
BROKER_CAPITAL_USD=500        # the amount you plan to go live with
APCA_API_KEY_ID=...           # Alpaca PAPER keys
APCA_API_SECRET_KEY=...
```
Redeploy, then open Settings → Broker. It should say **PAPER REHEARSAL** and show your paper equity.

**Go / no-go to live. All of these must hold:**
- [ ] It ran **≥ 14 days** with no crash and no unexplained halt.
- [ ] There are **≥ 10 broker fills**.
- [ ] **Median slippage ≤ 15 bps** vs the model price (shown in the fills table).
- [ ] **No unresolved drift** warnings.
- [ ] You triggered Halt, Resume, Flatten and the kill switch once each, and each did what it says.
- [ ] Paper P&L is **not more than 2 points worse** than the simulated account over the same period. If it is, fees and slippage are eating the edge, so don't go live.

## Phase 1b: Prediction-market arbitrage, paper (runs alongside Phase 1)

**Setup:** copy `deploy/pairs.example.json` to `$DATA_DIR/pairs.json` and add real pairs (a Kalshi ticker plus the Polymarket YES/NO token ids for the same event). Set `verified: true` only after reading **both** venues' resolution rules. Then set `PM_MODE=paper` and redeploy. Settings → Prediction-market arbitrage shows the opportunities, filled sets, locked/realised profit and where the money should be.

**Go / no-go to live (Kalshi legs only):**
- [ ] It ran **≥ 14 days** with **≥ 20 sets** taken.
- [ ] **Every set settled as a win.** A single loss means a pair wasn't really the same event: fix the watch list before anything else.
- [ ] The edge after fees **survives a 1¢ worse fill on every leg.** Paper fills at the quoted ask, while live books move.
- [ ] Live setup: `PM_MODE=live`, `KALSHI_KEY_ID`, `KALSHI_PRIVATE_KEY_PATH` and `PM_LIVE_CONFIRM=real-money`, starting with `PM_MAX_ARB_USD=20` and `PM_MAX_EXPOSURE_USD=200`.

**Honest limits:** paper fills assume the full ask size is there; it may not be. Capital stays locked until each event settles, which can take weeks, so returns per year depend on settlement time. Polymarket orders need a wallet-signed integration plus confirmed access where you live, so its legs stay paper until then. Cross-venue sets also carry resolution-rule risk, which no code removes. Only verification does.

## Phase 2: Live micro ($200–$500)

**Before flipping the switch:**
1. Open an Alpaca **live** account, fund it with **only** the capital figure, and check crypto trading is available in your state.
2. Create **live API keys**. Alpaca keys can trade but can't withdraw. Put them in the server `.env` only, never in the repo or in chat.
3. Set:
```
BROKER=live
BROKER_CAPITAL_USD=300
LIVE_MAX_ORDER_USD=30        # 10% of capital
LIVE_MAX_DAILY_LOSS_USD=9    # 3%
APCA_LIVE_KEY_ID=...
APCA_LIVE_SECRET_KEY=...
LIVE_CONFIRM=real-money
```
4. Redeploy. The log must print `BROKER=live: REAL MONEY ...` with your caps. Settings → Broker shows a red **LIVE · REAL MONEY** badge.

**Daily (2 minutes):** open Settings → Broker and check equity, today's P&L, the drift line and the last fills.
**Weekly:** compare live P&L against the paper account and against holding BTC. Write one line in a log.

**Stop rules (no debate):**
- Live is **down 10% of capital** since start → flatten, go back to paper, and find out why.
- **Slippage averages > 25 bps** for a week → halt. The edge is gone at this size or venue.
- Any **drift you can't explain** → halt until it's understood.

## Phase 3: Scale on evidence

- Raise `BROKER_CAPITAL_USD` **at most 2× per 30 days**, and only after a 30-day period that met every Phase 1 criterion with live fills.
- Keep the guards proportional. They scale from the capital by default; set them explicitly once you go past about $2k.
- Never add money to recover a loss.

## Phase 4: Make it safe to leave alone (next engineering work)

Order of priority. Each item ships with a test:
1. **Broker-side stop orders.** Today stops live in the engine, so if the server is down, nothing exits. Place a protective stop at Alpaca with every buy and cancel it on exit. **This is the most important item before you scale past micro.**
2. ~~Exits on every price refresh~~ Done: exits are checked every 10 s.
3. **Alerts:** a push or SMS on every live fill, halt and drift.
4. **Real-money state on the dashboard** next to the paper account, with live P&L vs paper vs BTC.
5. **Startup reconciliation:** on boot, compare broker positions with the ledger and halt if they differ.
6. **Tax export:** CSV of live fills. Every sell is a taxable event, and Alpaca also issues a 1099.

## On "high-frequency trading"

**What we built:** the fastest loop that can pay. The prediction-market engine re-prices every watched book every 2 s, or faster with `PM_EVERY_MS`; a pass over 9 markets takes about 10–20 ms. In prediction markets, speed is where the edge is: price gaps between venues close in seconds to minutes. Next step: websocket order-book feeds, so it reacts on each book change instead of each poll.

**What stays out of reach:** microsecond trading.

True HFT means microsecond reactions, co-located servers, direct exchange feeds, and fees of a fraction of a basis point. Vantrel is the opposite, and that's deliberate:
- **Fees decide it.** Retail crypto costs about 15–25 bps per side at Alpaca. Our own first version traded 4-hour bars and **lost money because fees ate the small moves** (`docs/02_BACKTEST.md`: BTC −53%). Faster trading means more trades, more fees and a worse result.
- **The edge is daily.** The brains were built and tested on daily bars. Running them every second doesn't add edge; it adds noise trades.
- **The infrastructure isn't there.** Alpaca's REST API is rate-limited to about 200 requests a minute and isn't co-located. Real HFT firms spend millions on latency.

What we will make faster is where speed protects money: **stop exits** (Phase 4, item 2) and **broker-side stops** (item 1). If high-frequency strategies are ever explored, do it as a separate research project on historical tick data with real fee models, and only go live if it beats fees out of sample.

## Ground rules
- **Your money only.** Trading other people's money with this system makes you an investment adviser and needs SEC/state registration. Don't.
- Keys live only in the server `.env`. The repo has `.env.example` with blanks.
- The paper site stays public for demos. The broker panel is visible only to `MIRROR_USER` / `OWNER_USER`.
- Not financial advice. The backtest is a small sample (98 trades), and the system lags in strong bull runs.
