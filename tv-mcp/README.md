# tripwire-tv-mcp

TradingView MCP server for **Tripwire**. It gives Tripwire's AI agents (and you, through Claude) live eyes on a TradingView chart:

- **What's the market doing?** Quotes, bars, and indicator values from the live chart.
- **Which brain should trade it?** A deterministic regime classifier picks `mean_reversion`, `trend`, `breakout`, or `shield` (hold cash).
- **What did Tripwire do?** Its trades and reasons are drawn straight onto the chart, and you can ask about the portfolio.

**It cannot trade.** It has no order tools; orders only go through Tripwire's Rust risk gate. The engine bridge sends GET requests only.

## How it works

```
Claude / Regime Agent ──MCP (stdio)──▶ tripwire-tv-mcp ──CDP :9222──▶ TradingView Desktop
                                              │
                                              └──GET only──▶ Tripwire engine (:8080)
```

TradingView Desktop is an Electron app. Started with `--remote-debugging-port=9222`, it lets this server read the chart through the Chrome DevTools Protocol. Everything runs locally.

## Regime → brain

The same rules as the Rust engine (`engine/src/engine.rs` on `engine/v1-platform`), checked in that order on daily bars:

| Regime | Rule | Brain |
|---|---|---|
| `HIGH_VOL` | ATR% ranks above 0.85 against the last 90 days | `BREAKOUT` |
| `TREND_UP` | ADX > 25, close > EMA200 and EMA50 > EMA200 | `TREND` |
| `TREND_DOWN` | close < SMA200 | `SHIELD`: hold cash (no shorting on Alpaca crypto) |
| `RANGE` | everything else | `MR`: buy sharp dips, sell the bounce |

[`regime.py`](src/tripwire_tv_mcp/regime.py) is a line-for-line port of the engine's indicator math. `tests/test_regime.py` checks it against the engine's own golden fixture, `backtest/fixtures/BTC_daily.csv` (1,743 days of BTC): every indicator matches to ~1e-12 and every labelled day gets the same regime. For the closest live match, chart `BINANCE:BTCUSDT` on the daily timeframe (the engine's data feed) with plenty of history loaded. Each reading includes a plain-English `reason` for the why-log.

## Tools (23)

| Group | Tools |
|---|---|
| Setup | `tv_health`, `tv_launch` |
| Chart | `chart_state`, `chart_set_symbol`, `chart_set_timeframe`, `chart_set_type`, `quote_get`, `ohlcv_get`, `study_values`, `pine_levels`, `pine_labels`, `chart_screenshot` |
| Regime | `market_regime`, `regime_scan`, `market_brief` (quote + regime + indicators in one call) |
| Overlay | `draw_trade_marker`, `draw_level`, `draw_thesis_note`, `plot_engine_trades`, `clear_tripwire_drawings` |
| Portfolio | `portfolio_summary`, `why_log`, `engine_regimes` (read-only, from the engine) |

Tools that take a `symbol` switch the chart and then put it back. Overlay drawings are tagged `TW`, and `clear_tripwire_drawings` removes only those.

## Run it

Requires Python 3.11+ and TradingView Desktop. Either route works:

```bash
cd tv-mcp
pip install -r requirements.txt        # the repo's usual setup; installs the tripwire-tv-mcp command
claude mcp add tripwire-tv -- tripwire-tv-mcp
```

```bash
cd tv-mcp
uv sync && uv run pytest               # with uv
claude mcp add tripwire-tv -- uv run --directory /path/to/tripwire/tv-mcp tripwire-tv-mcp
```

Settings come from the repo-root `.env` (same file as the engine, agents and `mcp/`); real environment variables win.

**Windows:** TradingView Desktop from the Microsoft Store lives in the locked `WindowsApps` folder, where the debug port often won't open. `tv_launch` finds it with `Get-AppxPackage`, and if a direct launch fails it copies the app once to `%LOCALAPPDATA%\tripwire-tv-mcp` and launches that copy (the result says `msix_local_copy: true`). If TradingView is already open without the debug port, use `tv_launch` with `kill_existing=true`.

Then ask: *"Launch TradingView and tell me which brain fits BTC and ETH right now."*

| Env var | Default | Meaning |
|---|---|---|
| `TV_CDP_PORT` | `9222` | TradingView debug port |
| `TV_APP_PATH` | auto-detect | Path to the TradingView binary |
| `TRIPWIRE_API_URL` | `http://127.0.0.1:8080` | Tripwire engine base URL (`TRIPWIRE_API` also accepted) |
| `TRIPWIRE_MCP_TOKEN` | | Read-only token from the dashboard, sent as `x-mcp-token` |
| `TRIPWIRE_DEV_USER` | | With the engine on `DEV=1`, act as `dev\|<name>` via `x-dev-user` |

## Engine contract

GET only, against the engine's `/v1` API:

```
GET /v1/accounts/me         -> portfolio_summary (mcp_token stripped)
GET /v1/accounts/me/events  -> why_log (trades, brain switches, risk-gate blocks with their code)
GET /v1/accounts/me/trades  -> plot_engine_trades (entry + exit arrows, filtered to the chart's coin)
GET /v1/market/regimes      -> engine_regimes (live call per coin; AI accepted or overridden by Rust)
```

The account routes need either `TRIPWIRE_MCP_TOKEN` or, locally, `TRIPWIRE_DEV_USER` with the engine started as `DEV=1`. Chart symbols map to engine coins by dropping the quote currency (`COINBASE:BTCUSD` → `BTC`).

## Caveats

- It relies on undocumented TradingView internals, which a TradingView update can break. All of those paths live in [`chart.py`](src/tripwire_tv_mcp/chart.py).
- A valid TradingView subscription is required. This doesn't bypass anything; it reads the app already running on your machine.
- Not affiliated with TradingView. CDP access patterns were informed by the MIT-licensed [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp); this is a from-scratch Python rewrite.
