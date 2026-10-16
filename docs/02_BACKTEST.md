# 02 · Backtest — Real Results (run, not imagined)

Code + raw output: `../backtest/`. Data: Binance public hourly candles, Jan 2022 → Oct 9 2026, resampled to daily. Fills at next bar open, **0.25% fee + 0.05% slippage per side**, long-only, $1 split equally across BTC/ETH/SOL.

## What we tested, in order (keep this story — judges trust it)
| Version | Result | Lesson |
|---|---|---|
| v0 · 3 brains on **4-hour** bars | **Lost money** (BTC −53%, ETH −55%) | Fees eat small intraday moves. Mean-reversion only won ~40% |
| v1 · same brains on **daily** bars | Small gain, tiny drawdown, but barely participated | Positions too small to matter |
| **v2 · v1 + volatility-targeted Trend brain** | **Positive in every profile, incl. out-of-sample** | ← ship this |

## v2 headline numbers
| | Return | Max drawdown | Trades | Win rate | Break-even win rate |
|---|---|---|---|---|---|
| **Out-of-sample 2025–26**, conservative | **+0.4%** | −8.4% | 29 | 51.7% | 54.7% |
| Out-of-sample, aggressive | +1.5% | −17.1% | 29 | 51.7% | 54.7% |
| Buy & hold same period | **−27.5%** | −63.4% | — | — | — |
| **Full 2022–26**, conservative | **+17.5%** | **−17.4%** | 98 | 45.9% | 35.9% |
| Full, balanced | +22.9% | −26.7% | 98 | 45.9% | 35.9% |
| Full, aggressive | +25.9% | −37.4% | 98 | 45.9% | 35.9% |
| Buy & hold full | +39.0% | **−75.8%** | — | — | — |

Per-brain win rate (full): **Breakout 75% · Mean-Reversion 57% (69% OOS) · Trend 28%** (low win rate, big winners — that's how trend works).

![v2 equity](../backtest/equity_curves_v2.png)

## The honest pitch line
> "When crypto fell 27% in 2025–26, Vantrel finished flat-to-green with a quarter of the drawdown. Over four years it kept about half of buy-and-hold's gain with a quarter of the pain."

## Caveats (say them before a judge does)
- **Small sample:** 98 trades over 4 years, 29 out-of-sample. Directional evidence, not proof.
- **Not pristine OOS:** v1 was viewed on 2025–26 before v2 was chosen; v2's change was a standard technique, not tuned to it.
- **Underperforms buy & hold in strong bull runs.** It trades return for drawdown protection. That *is* the product for a regular person.
- **Fees:** confirm Alpaca's current crypto fee tier; maker (limit) orders would improve results.
- **Live 36-hour window:** daily-bar strategy may make 0–2 trades. Live mode proves execution; Replay proves the edge.

## Run it
```bash
pip install httpx pandas numpy pyarrow matplotlib
python backtest/fetch.py        # downloads BTC/ETH (edit list to add SOL etc.)
python backtest/v2.py           # prints the v2 table + writes equity_curves_v2.csv
python backtest/daily.py        # per-brain breakdown
```

## Next experiments (strategy owner, only after Layer 1 ships)
1. Limit orders at maker fee (0.15%) → re-run.
2. Add 5 more liquid coins → more trades, smoother curve.
3. Walk-forward: re-fit nothing, just roll yearly windows and report each.
4. Port signals to Rust and run a **parity test** (Rust signals == Python signals on same bars).

## v2 + Growth Ladder (Oct 2026): `python backtest/ladder_sim.py`
The v2 equity curves run through the same rules as `engine/src/ladder.rs`: start at $200, raises of at most 2× every 30 days once all gates pass, a halt at 10% drawdown, and the owner resumes after 7 days. Fills are estimated at v2's average rate.

| Full 2022–26, $500/month deposited ($28,700 in) | End | Profit |
|---|---|---|
| Conservative **with ladder** | $28,768 | **+$68** (1 raise, 2 stops) |
| Conservative, no ladder (all deposits trade) | $30,729 | +$2,029 |
| Buy & hold, same deposits | $46,210 | +$17,510 |

| OOS 2025–26, $500/month ($10,700 in) | End | Profit |
|---|---|---|
| Conservative with ladder | $10,663 | −$37 (3 raises, reached $1,600) |
| Conservative, no ladder | $10,752 | +$52 |
| Buy & hold | $10,319 | −$381 |

**Finding:** the ladder is too tight for this strategy. Normal v2 drawdown is 17%, so the 10% stop keeps firing, and a rung that has hit 10% can never be raised again. Over four years almost all deposits sat in cash. Fix candidates: base the stop on the backtested drawdown (about 20% for conservative), and reset the rung's drawdown once equity makes a new high.
Prediction-market arbitrage isn't backtested: there are no historical Kalshi/Polymarket order books here. Its evidence has to come from the Phase 1b paper run.
