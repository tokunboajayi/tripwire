# Tripwire

**Set your risk. Fund it. AI trades for you, switching between 3 trading "brains" to fit the market, with a Rust safety layer it can't override.**

Hacklanta '26 · Fintech track · paper trading on live crypto · not financial advice.

## The problem
- Investing well is technical *and* emotional. Most people panic-sell the bottom and buy the top.
- Robinhood gives you a buy button. Robo-advisors park your money and never react. Bots run one strategy until it breaks.
- Nothing trades *for* a regular person, adapts to the market, controls risk, and explains itself.

## How it works
| Market | Brain | What it does |
|---|---|---|
| Calm | Mean-Reversion | buys sharp dips, sells the bounce |
| Trending up | Trend | rides it, sized by volatility |
| Volatile | Breakout | buys confirmed breakouts, tight trailing stop |
| Falling | Shield | holds cash until the market turns |

**The AI picks the brain. Rust checks every order.** The AI can tighten your limits but never loosen them.

## Results (real backtest, fees included)
| | Tripwire (conservative) | Buy & hold |
|---|---|---|
| 2025–26 (held out) | **+0.4%** | **−27.5%** |
| Worst drop, 2022–26 | **−17%** | **−76%** |

![equity](backtest/equity_curves_v2.png)
Small sample (98 trades). It lags in strong bull runs; it's built to protect. Details: `docs/02_BACKTEST.md`.

## Repo map
| Folder | What | Owner |
|---|---|---|
| `engine/` | Rust: indicators, regime, brains, risk gate, execution, API | Owner |
| `data/` `backtest/` | market data, fixtures, replays, backtest | B · Data |
| `agents/` `mcp/` | AI agents + MCP server | C · AI & MCP |
| `web/` `landing/` | dashboard + public site | D · Product |
| `docs/` | idea, spec, plan, prompts | everyone |

## Run
```bash
cp .env.example .env   # fill keys
docker compose -f deploy/docker-compose.yml up
```

## Team
| Name | Seat | GitHub |
|---|---|---|
| AJ (Olatokunbo Ajayi) | Owner · Engine | @tokunboajayi |
| Bryant Awoh | B · Data & Strategy | @Bawoh1 |
| Ebere | C · AI & MCP | @ubaniebereo |
| Kelly Awoh | D · Product | @kellyawoh-jpg |

Paper trading only. Not financial advice.
