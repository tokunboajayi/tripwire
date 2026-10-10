"""Deterministic market-regime classifier, ported from the Tripwire Rust engine.

Mirrors `engine/src/engine.rs` (`compute` + `regime`) on the engine/v1-platform
branch, which itself mirrors backtest/v2.py. Same indicators, same thresholds,
same rule order, same vocabulary, so the chart and the engine agree:

    1. ATR% in the top 15% of the last 90 days  -> HIGH_VOL   -> BREAKOUT
    2. ADX > 25, close > EMA200, EMA50 > EMA200 -> TREND_UP   -> TREND
    3. close < SMA200                           -> TREND_DOWN -> SHIELD
    4. otherwise                                -> RANGE      -> MR

tests/test_regime.py checks this file against the engine's golden fixture.
The engine's EMAs seed from its first daily candle (2021-06-01, Binance
BTCUSDT), so feed as much daily history as the chart has for a close match.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Callable, Sequence

NAN = float("nan")

ATR_ALPHA = 1 / 14
EMA50_ALPHA = 2 / 51
EMA200_ALPHA = 2 / 201
RSI2_ALPHA = 0.5
SMA_LEN = 200
ATRP_RANK_LEN = 90
ATRP_RANK_MIN = 30

HIGH_VOL_RANK = 0.85
TREND_ADX = 25.0

MIN_BARS = SMA_LEN

BRAIN_BY_REGIME = {"RANGE": "MR", "TREND_UP": "TREND", "HIGH_VOL": "BREAKOUT", "TREND_DOWN": "SHIELD"}
REGIME_LABEL = {"RANGE": "Calm", "TREND_UP": "Trending up", "HIGH_VOL": "High volatility", "TREND_DOWN": "Falling"}
BRAIN_LABEL = {"MR": "Mean-Reversion", "TREND": "Trend", "BREAKOUT": "Breakout", "SHIELD": "Shield"}


@dataclass(frozen=True)
class Bar:
    time: float
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


@dataclass(frozen=True)
class Indicators:
    atr: list[float]
    ema50: list[float]
    ema200: list[float]
    sma200: list[float]
    adx: list[float]
    rsi2: list[float]
    atrp_rank: list[float]


@dataclass(frozen=True)
class RegimeReading:
    regime: str
    brain: str
    regime_label: str
    brain_label: str
    reason: str
    close: float
    adx: float
    ema50: float
    ema200: float
    sma200: float
    atrp_rank: float
    rsi2: float
    atr: float
    bars_used: int

    def to_dict(self) -> dict:
        return asdict(self)


class InsufficientBars(ValueError):
    pass


def _div(a: float, b: float) -> float:
    """IEEE-754 division like Rust f64: x/0 is +-inf, 0/0 is NaN."""
    if b == 0:
        return NAN if a == 0 or math.isnan(a) else math.copysign(math.inf, a)
    return a / b


def ewm(xs: Sequence[float], alpha: float) -> list[float]:
    """pandas .ewm(alpha, adjust=False).mean(): seeds at the first non-NaN, holds through NaN."""
    out, prev = [], None
    for v in xs:
        if math.isnan(v):
            out.append(NAN if prev is None else prev)
            continue
        prev = v if prev is None else (1 - alpha) * prev + alpha * v
        out.append(prev)
    return out


def _roll(xs: Sequence[float], window: int, min_periods: int, fn: Callable[[list[float], float], float]) -> list[float]:
    out = []
    for i, x in enumerate(xs):
        if math.isnan(x):
            out.append(NAN)
            continue
        win = [v for v in xs[max(0, i + 1 - window): i + 1] if not math.isnan(v)]
        out.append(NAN if len(win) < min_periods else fn(win, x))
    return out


def _mean(win: list[float], _x: float) -> float:
    return sum(win) / len(win)


def _pct_rank(win: list[float], x: float) -> float:
    less = sum(1 for v in win if v < x)
    equal = sum(1 for v in win if v == x)
    return (less + (equal + 1) / 2) / len(win)


def compute(bars: Sequence[Bar]) -> Indicators:
    n = len(bars)
    c = [b.close for b in bars]
    h = [b.high for b in bars]
    lo = [b.low for b in bars]

    tr = [h[0] - lo[0]] + [
        max(h[i] - lo[i], abs(h[i] - c[i - 1]), abs(lo[i] - c[i - 1])) for i in range(1, n)
    ]
    atr = ewm(tr, ATR_ALPHA)

    pdm, ndm = [0.0] * n, [0.0] * n
    for i in range(1, n):
        up, dn = h[i] - h[i - 1], lo[i - 1] - lo[i]
        if up > dn and up > 0:
            pdm[i] = up
        if dn > up and dn > 0:
            ndm[i] = dn
    pe, ne = ewm(pdm, ATR_ALPHA), ewm(ndm, ATR_ALPHA)
    dx = []
    for i in range(n):
        p, q = 100 * _div(pe[i], atr[i]), 100 * _div(ne[i], atr[i])
        dx.append(100 * _div(abs(p - q), p + q))

    diff = [NAN] + [c[i] - c[i - 1] for i in range(1, n)]
    ge = ewm([d if math.isnan(d) else max(d, 0.0) for d in diff], RSI2_ALPHA)
    le = ewm([d if math.isnan(d) else -min(d, 0.0) for d in diff], RSI2_ALPHA)
    rsi2 = [100 - _div(100, 1 + _div(ge[i], le[i])) for i in range(n)]

    atrp = [_div(atr[i], c[i]) for i in range(n)]
    return Indicators(
        atr=atr,
        ema50=ewm(c, EMA50_ALPHA),
        ema200=ewm(c, EMA200_ALPHA),
        sma200=_roll(c, SMA_LEN, SMA_LEN, _mean),
        adx=ewm(dx, ATR_ALPHA),
        rsi2=rsi2,
        atrp_rank=_roll(atrp, ATRP_RANK_LEN, ATRP_RANK_MIN, _pct_rank),
    )


def regime_at(close: float, adx: float, ema50: float, ema200: float, sma200: float, atrp_rank: float) -> str:
    """engine.rs `regime()`; NaN comparisons are False, exactly as in Rust."""
    if atrp_rank > HIGH_VOL_RANK:
        return "HIGH_VOL"
    if adx > TREND_ADX and close > ema200 and ema50 > ema200:
        return "TREND_UP"
    if close < sma200:
        return "TREND_DOWN"
    return "RANGE"


def _reason(regime: str, close: float, adx: float, ema50: float, ema200: float, sma200: float, rank: float) -> str:
    if regime == "HIGH_VOL":
        return (f"volatility (ATR%) ranks {rank:.2f} against the last {ATRP_RANK_LEN} days, above {HIGH_VOL_RANK}; "
                "buy confirmed breakouts with a tight trailing stop")
    if regime == "TREND_UP":
        return (f"ADX {adx:.1f} > {TREND_ADX:.0f} with price and EMA50 ({ema50:.2f}) above EMA200 ({ema200:.2f}); "
                "ride the trend, sized by volatility")
    if regime == "TREND_DOWN":
        return f"price {close:.2f} below the 200-day average ({sma200:.2f}); long-only, so hold cash"
    return (f"ADX {adx:.1f} and volatility rank {rank:.2f} with price above the 200-day average; "
            "calm market, buy sharp dips and sell the bounce")


def classify(bars: Sequence[Bar]) -> RegimeReading:
    if len(bars) < MIN_BARS:
        raise InsufficientBars(
            f"regime needs at least {MIN_BARS} daily bars, got {len(bars)}; scroll the chart back to load more history"
        )
    ind = compute(bars)
    close = bars[-1].close
    vals = (ind.adx[-1], ind.ema50[-1], ind.ema200[-1], ind.sma200[-1], ind.atrp_rank[-1])
    regime = regime_at(close, *vals)
    brain = BRAIN_BY_REGIME[regime]
    return RegimeReading(
        regime=regime,
        brain=brain,
        regime_label=REGIME_LABEL[regime],
        brain_label=BRAIN_LABEL[brain],
        reason=_reason(regime, close, *vals),
        close=round(close, 8),
        adx=round(ind.adx[-1], 4),
        ema50=round(ind.ema50[-1], 8),
        ema200=round(ind.ema200[-1], 8),
        sma200=round(ind.sma200[-1], 8),
        atrp_rank=round(ind.atrp_rank[-1], 4),
        rsi2=round(ind.rsi2[-1], 4),
        atr=round(ind.atr[-1], 8),
        bars_used=len(bars),
    )


def bars_from_dicts(rows: Sequence[dict]) -> list[Bar]:
    return [
        Bar(
            time=float(r["time"]),
            open=float(r["open"]),
            high=float(r["high"]),
            low=float(r["low"]),
            close=float(r["close"]),
            volume=float(r.get("volume") or 0),
        )
        for r in rows
    ]
