import csv
import math
from pathlib import Path

import pytest

from vantrel_tv_mcp.regime import (
    BRAIN_BY_REGIME,
    MIN_BARS,
    Bar,
    InsufficientBars,
    bars_from_dicts,
    classify,
    compute,
    ewm,
    regime_at,
)

# The engine's golden fixture: shared with the Rust parity test in the monorepo,
# or a local copy when this package is used on its own.
_FIXTURES = [
    Path(__file__).resolve().parents[2] / "backtest" / "fixtures" / "BTC_daily.csv",
    Path(__file__).parent / "fixtures" / "BTC_daily.csv",
]
FIXTURE = next((p for p in _FIXTURES if p.exists()), _FIXTURES[0])
PARITY_TOLERANCE = 1e-9  # the fixture's CSV is printed to ~12 significant digits


def load_fixture():
    if not FIXTURE.exists():
        pytest.skip("engine fixture BTC_daily.csv not found")
    rows = list(csv.DictReader(FIXTURE.open()))
    num = lambda r, k: float(r[k]) if r[k] else math.nan  # noqa: E731
    bars = [Bar(num(r, "t"), num(r, "o"), num(r, "h"), num(r, "l"), num(r, "c"), num(r, "v")) for r in rows]
    return rows, bars, num


def make_bars(closes, spread=1.0, spreads=None):
    bars = []
    prev = closes[0]
    for i, c in enumerate(closes):
        s = spreads[i] if spreads else spread
        bars.append(Bar(time=i, open=prev, high=max(prev, c) + s, low=min(prev, c) - s, close=c))
        prev = c
    return bars


# --- Parity with the Rust engine (its own golden fixture) -------------------

def test_indicators_match_engine_fixture():
    rows, bars, num = load_fixture()
    ind = compute(bars)
    for key in ("atr", "ema50", "ema200", "sma200", "adx", "rsi2", "atrp_rank"):
        mine = getattr(ind, key)
        for i, row in enumerate(rows):
            want = num(row, key)
            if math.isnan(want):
                assert math.isnan(mine[i]), f"{key}[{i}] should be NaN"
            else:
                assert mine[i] == pytest.approx(want, rel=PARITY_TOLERANCE), f"{key}[{i}]"


def test_regimes_match_engine_on_every_labelled_day():
    rows, bars, _ = load_fixture()
    ind = compute(bars)
    labelled = [(i, r["regime"]) for i, r in enumerate(rows) if r["regime"]]
    assert len(labelled) > 1500
    for i, want in labelled:
        got = regime_at(bars[i].close, ind.adx[i], ind.ema50[i], ind.ema200[i], ind.sma200[i], ind.atrp_rank[i])
        assert got == want, f"day {i} ({rows[i]['t']})"


def test_classify_last_fixture_day():
    rows, bars, _ = load_fixture()
    reading = classify(bars)
    assert reading.regime == rows[-1]["regime"]
    assert reading.brain == BRAIN_BY_REGIME[reading.regime]


# --- Rule order and vocabulary ----------------------------------------------

def test_rule_order():
    assert regime_at(100, adx=40, ema50=90, ema200=80, sma200=200, atrp_rank=0.9) == "HIGH_VOL"
    assert regime_at(100, adx=26, ema50=90, ema200=80, sma200=95, atrp_rank=0.5) == "TREND_UP"
    assert regime_at(100, adx=20, ema50=90, ema200=80, sma200=110, atrp_rank=0.5) == "TREND_DOWN"
    assert regime_at(100, adx=20, ema50=90, ema200=80, sma200=95, atrp_rank=0.5) == "RANGE"


def test_thresholds_are_strict():
    assert regime_at(100, adx=20, ema50=90, ema200=80, sma200=95, atrp_rank=0.85) == "RANGE"
    assert regime_at(100, adx=25, ema50=90, ema200=80, sma200=95, atrp_rank=0.5) == "RANGE"


def test_nan_indicators_fall_through_like_rust():
    assert regime_at(100, math.nan, math.nan, math.nan, math.nan, math.nan) == "RANGE"


def test_brains_use_engine_vocabulary():
    assert BRAIN_BY_REGIME == {"RANGE": "MR", "TREND_UP": "TREND", "HIGH_VOL": "BREAKOUT", "TREND_DOWN": "SHIELD"}


def test_rejects_too_few_bars():
    with pytest.raises(InsufficientBars):
        classify(make_bars([100.0] * (MIN_BARS - 1)))


def test_steady_uptrend_is_trend_up():
    reading = classify(make_bars([100 + i * 0.5 for i in range(300)]))
    assert (reading.regime, reading.brain) == ("TREND_UP", "TREND")
    assert "ADX" in reading.reason


def test_falling_market_is_shield():
    # a sell-off, then a quiet base below the 200-day average (a steady slide alone reads HIGH_VOL: ATR% climbs)
    closes = [300 * 0.995**i for i in range(220)] + [100.0 + (i % 2) * 0.1 for i in range(80)]
    spreads = [c * 0.01 for c in closes[:220]] + [0.05] * 80
    reading = classify(make_bars(closes, spreads=spreads))
    assert (reading.regime, reading.brain) == ("TREND_DOWN", "SHIELD")


def test_volatility_spike_is_breakout_even_in_downtrend():
    closes = [300 - i * 0.5 for i in range(300)]
    spreads = [1.0] * 290 + [15.0] * 10
    reading = classify(make_bars(closes, spreads=spreads))
    assert (reading.regime, reading.brain) == ("HIGH_VOL", "BREAKOUT")


# --- Helpers ----------------------------------------------------------------

def test_ewm_seeds_at_first_value_and_holds_through_nan():
    out = ewm([math.nan, 10.0, math.nan, 20.0], 0.5)
    assert math.isnan(out[0]) and out[1:] == [10.0, 10.0, 15.0]


def test_flat_market_does_not_crash():
    bars = [Bar(time=i, open=10, high=10, low=10, close=10) for i in range(MIN_BARS)]
    assert classify(bars).regime == "RANGE"


def test_bars_from_dicts_handles_missing_volume():
    bars = bars_from_dicts([{"time": 1, "open": 1, "high": 2, "low": 0.5, "close": 1.5}])
    assert bars[0].volume == 0.0


def test_same_resolution_normalizes_daily():
    from vantrel_tv_mcp.chart import same_resolution

    assert same_resolution("D", "1D") and same_resolution("1W", "W")
    assert not same_resolution("5", "15") and same_resolution("60", "60")
