"""Tripwire TradingView MCP server.

Gives Tripwire's agents (and anyone talking to Claude) eyes on a live
TradingView chart: prices, indicators, the current market regime and which
strategy brain fits it, plus a way to draw Tripwire's trades onto the chart.

It cannot trade. Orders only go through the Tripwire Rust risk gate.
"""

from __future__ import annotations

from typing import Literal

from mcp.server.fastmcp import FastMCP, Image
from mcp.types import ToolAnnotations

from . import launch as launcher
from .cdp import CDPClient
from .chart import Chart
from .drawing import Drawer
from .engine import EngineClient, engine_symbol
from .regime import MIN_BARS, bars_from_dicts, classify

INSTRUCTIONS = """Tripwire TradingView bridge. Read a live TradingView Desktop chart and
show Tripwire's decisions on it. This server cannot place orders.

Start here:
- tv_health: is TradingView reachable? If not, tv_launch.
- market_brief: one call for quote + regime + indicator values (best for the Regime Agent).
- market_regime / regime_scan: which brain fits now (MR, TREND, BREAKOUT, SHIELD), same rules as the engine.
- engine_regimes: the engine's live call per coin, including whether Rust overrode the AI.

Chart: chart_state, chart_set_symbol, chart_set_timeframe, chart_set_type, quote_get,
ohlcv_get (summary=true by default), study_values, pine_levels, pine_labels, chart_screenshot.

Tripwire overlay: draw_trade_marker, draw_level, draw_thesis_note, plot_engine_trades,
clear_tripwire_drawings (removes only Tripwire's own drawings).

Portfolio (read-only, from the Tripwire engine): portfolio_summary, why_log, engine_regimes.

Crypto symbols: use exchange-qualified tickers. BINANCE:BTCUSDT on the daily chart matches the
engine's own data feed exactly; COINBASE:BTCUSD is close but not identical."""

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
CHANGES_CHART = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True)
DRAWS = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False)

mcp = FastMCP("tripwire-tv", instructions=INSTRUCTIONS)
cdp = CDPClient()
chart = Chart(cdp)
drawer = Drawer(cdp)
engine = EngineClient()

REGIME_BARS = 1000  # the engine's EMAs seed in 2021; more history = closer match


def _summarize(rows: list[dict]) -> dict:
    first, last = rows[0], rows[-1]
    hi, lo = max(r["high"] for r in rows), min(r["low"] for r in rows)
    return {
        "bar_count": len(rows),
        "from": first["time"],
        "to": last["time"],
        "open": first["open"],
        "close": last["close"],
        "high": hi,
        "low": lo,
        "change_pct": round((last["close"] - first["open"]) / first["open"] * 100, 3),
        "avg_volume": round(sum(r["volume"] for r in rows) / len(rows), 2),
        "last_5_bars": rows[-5:],
    }


# --- Health -----------------------------------------------------------------

@mcp.tool(annotations=READ)
async def tv_health() -> dict:
    """Check that TradingView Desktop is reachable and a chart is open."""
    targets = await cdp.list_targets()
    state = await chart.state()
    return {"cdp_port": cdp.port, "targets": len(targets), "chart_url": (cdp.target or {}).get("url"), **state}


@mcp.tool()
async def tv_launch(kill_existing: bool = False) -> dict:
    """Start TradingView Desktop with the debug port open. kill_existing restarts a running copy that lacks the flag."""
    return await launcher.launch(cdp, kill_existing=kill_existing)


# --- Chart ------------------------------------------------------------------

@mcp.tool(annotations=READ)
async def chart_state() -> dict:
    """Current symbol, timeframe, chart type, bars loaded, and indicators (with entity ids)."""
    return await chart.state()


@mcp.tool(annotations=CHANGES_CHART)
async def chart_set_symbol(symbol: str) -> dict:
    """Switch the chart symbol, e.g. COINBASE:BTCUSD or NASDAQ:NVDA."""
    async with chart.switch_lock:
        return await chart.set_symbol(symbol)


@mcp.tool(annotations=CHANGES_CHART)
async def chart_set_timeframe(timeframe: str) -> dict:
    """Switch the timeframe: 1, 5, 15, 60, 240, D, W."""
    async with chart.switch_lock:
        return await chart.set_timeframe(timeframe)


@mcp.tool(annotations=CHANGES_CHART)
async def chart_set_type(chart_type: Literal["candles", "bars", "line", "area", "heikinashi", "hollowcandles"]) -> dict:
    """Change the chart style."""
    return await chart.set_type(chart_type)


@mcp.tool(annotations=READ)
async def quote_get(symbol: str | None = None) -> dict:
    """Latest price for the chart symbol, or for `symbol` (the chart is switched back afterwards)."""
    return await chart.with_symbol(symbol, None, chart.quote)


@mcp.tool(annotations=READ)
async def ohlcv_get(
    count: int = 100, summary: bool = True, symbol: str | None = None, timeframe: str | None = None
) -> dict:
    """Price bars from the chart (max 2000). Keep summary=true unless you need every bar."""
    rows = await chart.with_symbol(symbol, timeframe, lambda: chart.bars(count))
    return _summarize(rows) if summary else {"bar_count": len(rows), "bars": rows}


@mcp.tool(annotations=READ)
async def study_values() -> list[dict]:
    """Current values of every visible indicator (RSI, EMA, MACD, ...)."""
    return await chart.study_values()


@mcp.tool(annotations=READ)
async def pine_levels(study_filter: str = "") -> list[dict]:
    """Horizontal price levels drawn by Pine indicators (line.new). Filter by indicator name."""
    return await chart.pine_levels(study_filter)


@mcp.tool(annotations=READ)
async def pine_labels(study_filter: str = "", limit: int = 50) -> list[dict]:
    """Text labels drawn by Pine indicators (label.new), with prices."""
    return await chart.pine_labels(study_filter, limit)


@mcp.tool(annotations=READ)
async def chart_screenshot(region: Literal["chart", "full"] = "chart") -> Image:
    """Screenshot of the chart pane (or the full window) returned as an image."""
    clip = await chart.chart_clip() if region == "chart" else None
    return Image(data=await cdp.screenshot(clip), format="png")


# --- Tripwire: regime -------------------------------------------------------

async def _regime_now() -> dict:
    rows = await chart.bars(REGIME_BARS)
    reading = classify(bars_from_dicts(rows)).to_dict()
    state = await chart.state()
    return {"symbol": state["symbol"], "timeframe": state["resolution"], **reading}


@mcp.tool(annotations=READ)
async def market_regime(symbol: str | None = None, timeframe: str | None = "D") -> dict:
    """Classify the market (RANGE / TREND_UP / HIGH_VOL / TREND_DOWN) and name the brain (MR / TREND / BREAKOUT / SHIELD).

    The Rust engine's own rules, in order: ATR% in the top 15% of 90 days -> HIGH_VOL;
    ADX > 25 with price and EMA50 above EMA200 -> TREND_UP; price below SMA200 -> TREND_DOWN;
    else RANGE. The engine uses daily bars, so timeframe defaults to D.
    """
    return await chart.with_symbol(symbol, timeframe, _regime_now)


@mcp.tool(annotations=READ)
async def regime_scan(symbols: list[str], timeframe: str = "D") -> list[dict]:
    """Run market_regime across several symbols, e.g. ["COINBASE:BTCUSD", "COINBASE:ETHUSD"]."""
    results = []
    for sym in symbols[:12]:
        try:
            results.append(await chart.with_symbol(sym, timeframe, _regime_now))
        except Exception as exc:  # one bad symbol shouldn't sink the scan
            results.append({"symbol": sym, "error": str(exc)})
    return results


@mcp.tool(annotations=READ)
async def market_brief(symbol: str | None = None, timeframe: str = "D") -> dict:
    """One-call context for the Regime Agent: quote, regime + brain, and indicator values."""

    async def brief() -> dict:
        quote = await chart.quote()
        try:
            regime = await _regime_now()
        except ValueError as exc:
            regime = {"error": str(exc), "min_bars": MIN_BARS}
        return {"quote": quote, "regime": regime, "indicators": await chart.study_values()}

    return await chart.with_symbol(symbol, timeframe, brief)


# --- Tripwire: chart overlay -------------------------------------------------

@mcp.tool(annotations=DRAWS)
async def draw_trade_marker(time: float, price: float, side: Literal["buy", "sell"], text: str = "") -> dict:
    """Draw a buy/sell arrow at a bar. time is unix seconds (ms also accepted)."""
    return await drawer.trade_marker(time, price, side, text)


@mcp.tool(annotations=DRAWS)
async def draw_level(price: float, kind: Literal["stop", "target", "note", "buy", "sell"] = "note", text: str = "") -> dict:
    """Draw a horizontal line for a stop, target, or entry."""
    return await drawer.level(price, kind, text)


@mcp.tool(annotations=DRAWS)
async def draw_thesis_note(time: float, price: float, text: str, brain: str | None = None) -> dict:
    """Pin the plain-English reason for a trade onto the chart, colored by brain."""
    return await drawer.note(time, price, text, brain)


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True))
async def clear_tripwire_drawings() -> dict:
    """Remove the drawings this server created. The user's own drawings are left alone."""
    return await drawer.clear_tripwire()


def trade_markers(trade: dict) -> list[tuple[float, float, str, str]]:
    """One engine round trip -> (time, price, side, text) for its entry and exit arrows."""
    brain = trade.get("brain") or ""
    return [
        (trade["opened"], trade["entry"], "buy", brain),
        (trade["closed"], trade["exit"], "sell", f"{brain} {trade.get('ret', 0) * 100:+.1f}% {trade.get('reason') or ''}".strip()),
    ]


@mcp.tool(annotations=DRAWS)
async def plot_engine_trades(limit: int = 50) -> dict:
    """Fetch Tripwire's closed trades for the chart symbol from the engine and draw entry/exit arrows."""
    state = await chart.state()
    symbol = state["symbol"]
    trades = await engine.trades(symbol=symbol, limit=limit)
    drawn = [await drawer.trade_marker(*m) for t in trades for m in trade_markers(t)]
    return {"symbol": symbol, "engine_symbol": engine_symbol(symbol), "trades": len(trades), "drawn": len(drawn)}


# --- Tripwire: portfolio (read-only) ----------------------------------------

@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True))
async def portfolio_summary() -> dict:
    """Account equity, today's P&L, open positions, risk level and goal, from the Tripwire engine."""
    return await engine.portfolio()


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True))
async def engine_regimes() -> list[dict]:
    """The engine's live regime and brain per coin, the AI's call, and whether Rust accepted or overrode it."""
    return await engine.regimes()


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True))
async def why_log(limit: int = 20) -> list[dict]:
    """Recent decisions with plain-English reasons, including what the risk gate blocked."""
    return await engine.decisions(limit)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
