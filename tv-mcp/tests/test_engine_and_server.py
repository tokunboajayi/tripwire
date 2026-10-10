import httpx
import pytest

from tripwire_tv_mcp import server
from tripwire_tv_mcp.drawing import Drawer, _unix_seconds
from tripwire_tv_mcp.engine import EngineClient, EngineError, auth_headers, engine_symbol


def engine_with(handler) -> EngineClient:
    return EngineClient("http://engine.test", transport=httpx.MockTransport(handler), headers={})


ACCOUNT = {"user": "dev|eb", "equity": 10_250.0, "pnl_today": 12.5, "positions": [], "mcp_token": "secret"}
TRADES = [
    {"symbol": "BTC", "brain": "MR", "regime": "RANGE", "entry": 60_000.0, "exit": 61_200.0, "qty": 0.1,
     "pnl": 110.0, "ret": 0.018, "reason": "target", "opened": 1_700_000_000, "closed": 1_700_086_400},
    {"symbol": "ETH", "brain": "TREND", "regime": "TREND_UP", "entry": 3_000.0, "exit": 2_950.0, "qty": 1.0,
     "pnl": -55.0, "ret": -0.018, "reason": "stop", "opened": 1_700_100_000, "closed": 1_700_200_000},
    {"symbol": "BTC", "brain": "BREAKOUT", "regime": "HIGH_VOL", "entry": 62_000.0, "exit": 63_000.0, "qty": 0.1,
     "pnl": 90.0, "ret": 0.016, "reason": "trail", "opened": 1_700_300_000, "closed": 1_700_400_000},
]
EVENTS = [
    {"id": 3, "ts": 30, "account": "dev|eb", "kind": "gate_block", "msg": "Blocked: LIMIT_LOOSEN_DENIED.", "data": {"code": "LIMIT_LOOSEN_DENIED"}},
    {"id": 2, "ts": 20, "account": None, "kind": "tick", "msg": "", "data": {}},
    {"id": 1, "ts": 10, "account": "dev|eb", "kind": "order", "msg": "Bought BTC.", "data": {"symbol": "BTC", "brain": "MR"}},
]
ROUTES = {"/v1/accounts/me": ACCOUNT, "/v1/accounts/me/trades": TRADES, "/v1/accounts/me/events": EVENTS}


def fake_engine(seen=None, headers=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(200, json=ROUTES[request.url.path])

    return EngineClient("http://engine.test", transport=httpx.MockTransport(handler), headers=headers or {})


async def test_engine_only_sends_get_to_v1_routes():
    seen = []
    eng = fake_engine(seen)
    await eng.portfolio()
    await eng.decisions(limit=10_000)
    await eng.trades(symbol="COINBASE:BTCUSD", limit=5)
    assert all(r.method == "GET" for r in seen)
    assert [r.url.path for r in seen] == ["/v1/accounts/me", "/v1/accounts/me/events", "/v1/accounts/me/trades"]


async def test_portfolio_never_leaks_mcp_token():
    assert "mcp_token" not in await fake_engine().portfolio()


async def test_trades_filtered_by_chart_symbol_newest_first():
    trades = await fake_engine().trades(symbol="BINANCE:BTCUSDT", limit=50)
    assert [t["brain"] for t in trades] == ["BREAKOUT", "MR"]
    assert len(await fake_engine().trades(limit=1)) == 1


async def test_decisions_skip_silent_events_and_surface_gate_codes():
    log = await fake_engine().decisions(limit=20)
    assert [d["time"] for d in log] == [30, 10]
    assert log[0]["gate"] == "LIMIT_LOOSEN_DENIED"
    assert log[1]["symbol"] == "BTC" and log[1]["brain"] == "MR"


async def test_auth_header_is_sent():
    seen = []
    await fake_engine(seen, headers={"x-mcp-token": "tok"}).portfolio()
    assert seen[0].headers["x-mcp-token"] == "tok"


def test_auth_headers_prefers_mcp_token():
    assert auth_headers({"TRIPWIRE_MCP_TOKEN": "t", "TRIPWIRE_DEV_USER": "u"}) == {"x-mcp-token": "t"}
    assert auth_headers({"TRIPWIRE_DEV_USER": "u"}) == {"x-dev-user": "u"}
    assert auth_headers({}) == {}


@pytest.mark.parametrize(
    "chart_sym,want",
    [("COINBASE:BTCUSD", "BTC"), ("BINANCE:ETHUSDT", "ETH"), ("SOLUSDC", "SOL"), ("BTC", "BTC"), ("USD", "USD")],
)
def test_engine_symbol(chart_sym, want):
    assert engine_symbol(chart_sym) == want


async def test_unauthorized_explains_fix():
    eng = engine_with(lambda r: httpx.Response(401, text="sign in"))
    with pytest.raises(EngineError, match="TRIPWIRE_MCP_TOKEN"):
        await eng.portfolio()


def test_trade_markers_entry_and_exit():
    buy, sell = server.trade_markers(TRADES[0])
    assert buy == (1_700_000_000, 60_000.0, "buy", "MR")
    assert sell[:3] == (1_700_086_400, 61_200.0, "sell") and "+1.8%" in sell[3]


async def test_engine_error_status_raises():
    eng = engine_with(lambda r: httpx.Response(503, text="down"))
    with pytest.raises(EngineError, match="503"):
        await eng.portfolio()


async def test_engine_unreachable_explains_fix():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(EngineError, match="TRIPWIRE_API_URL"):
        await engine_with(handler).portfolio()


async def test_drawer_rejects_bad_input_before_touching_chart():
    drawer = Drawer(cdp=None)  # any CDP call would crash, so these must fail first
    with pytest.raises(ValueError):
        await drawer.trade_marker(1, 100, "short")
    with pytest.raises(ValueError):
        await drawer.trade_marker(1, float("nan"), "buy")
    with pytest.raises(ValueError):
        await drawer.level(100, kind="moon")


def test_unix_seconds_accepts_ms():
    assert _unix_seconds(1_700_000_000_000) == 1_700_000_000
    assert _unix_seconds(1_700_000_000) == 1_700_000_000


async def test_no_order_tools_exposed():
    names = {t.name for t in await server.mcp.list_tools()}
    assert {"market_regime", "market_brief", "chart_screenshot", "why_log", "plot_engine_trades", "engine_regimes"} <= names
    assert not any(word in n for n in names for word in ("order", "buy", "sell", "trade_place", "execute"))


async def test_read_tools_are_annotated_read_only():
    tools = {t.name: t for t in await server.mcp.list_tools()}
    for name in ("chart_state", "quote_get", "market_regime", "portfolio_summary", "why_log", "engine_regimes"):
        assert tools[name].annotations.readOnlyHint is True


def test_summarize():
    rows = [
        {"time": 1, "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100},
        {"time": 2, "open": 11, "high": 13, "low": 10, "close": 12, "volume": 300},
    ]
    s = server._summarize(rows)
    assert s["high"] == 13 and s["low"] == 9 and s["change_pct"] == 20.0 and s["avg_volume"] == 200
