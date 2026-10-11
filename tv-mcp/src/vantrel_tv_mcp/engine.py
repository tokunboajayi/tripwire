"""Read-only bridge to the Vantrel engine (Rust service, engine/v1-platform).

Only GET requests, by design: the MCP server can explain and visualize what
Vantrel did, but it can never place, change, or cancel an order. Orders go
through the Rust risk gate and nowhere else.

Engine routes used (all JSON, no envelope):
    GET /v1/accounts/me         -> {equity, cash, pnl_today, pnl_total, goal, limits, positions, stats, digest, ...}
    GET /v1/accounts/me/trades  -> [{symbol, brain, regime, entry, exit, qty, pnl, ret, reason, opened, closed}]  oldest first
    GET /v1/accounts/me/events  -> [{id, ts, account, kind, msg, data}]  newest first, max 200
    GET /v1/market/regimes      -> [{symbol, price, regime, brain, deterministic, source, confidence, ...}]

Auth (pick one):
    VANTREL_MCP_TOKEN  read-only token from the dashboard; sent as x-mcp-token
    VANTREL_DEV_USER   engine running with DEV=1; sent as x-dev-user
"""

from __future__ import annotations

import os
from typing import Any, Mapping

import httpx

# Pre-rebrand names (TRIPWIRE_*) still work.
for _k, _v in list(os.environ.items()):
    if _k.startswith("TRIPWIRE_") and _v and not os.environ.get("VANTREL_" + _k[9:]):
        os.environ["VANTREL_" + _k[9:]] = _v

ENGINE_URL = (
    os.environ.get("VANTREL_API_URL") or os.environ.get("VANTREL_API") or "http://127.0.0.1:8080"
).rstrip("/")
TIMEOUT_S = 5.0
MAX_LIMIT = 200
QUOTE_SUFFIXES = ("USDT", "USDC", "USD")


class EngineError(RuntimeError):
    pass


def auth_headers(env: Mapping[str, str] | None = None) -> dict[str, str]:
    env = os.environ if env is None else env
    if token := env.get("VANTREL_MCP_TOKEN"):
        return {"x-mcp-token": token}
    if user := env.get("VANTREL_DEV_USER"):
        return {"x-dev-user": user}
    return {}


def engine_symbol(chart_symbol: str) -> str:
    """COINBASE:BTCUSD / BINANCE:BTCUSDT / BTC -> BTC, the engine's symbol."""
    ticker = chart_symbol.split(":")[-1].upper()
    for suffix in QUOTE_SUFFIXES:
        if ticker.endswith(suffix) and len(ticker) > len(suffix):
            return ticker[: -len(suffix)]
    return ticker


def _clamp(limit: int) -> int:
    return min(max(int(limit), 1), MAX_LIMIT)


class EngineClient:
    def __init__(
        self,
        base_url: str = ENGINE_URL,
        transport: httpx.AsyncBaseTransport | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url
        self._transport = transport
        self._headers = auth_headers() if headers is None else headers

    async def _get(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport, headers=self._headers) as http:
                resp = await http.get(url)
        except httpx.HTTPError as exc:
            raise EngineError(
                f"Vantrel engine not reachable at {self.base_url} ({exc}). "
                "Start the engine or set VANTREL_API_URL."
            ) from exc
        if resp.status_code == 401:
            raise EngineError(
                f"GET {path} needs sign-in: set VANTREL_MCP_TOKEN (dashboard Settings) "
                "or VANTREL_DEV_USER when the engine runs with DEV=1."
            )
        if resp.status_code == 404 and path.startswith("/v1/accounts/me"):
            raise EngineError("No Vantrel account for this user yet; create one in the dashboard first.")
        if resp.status_code != 200:
            raise EngineError(f"GET {path} returned {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    async def portfolio(self) -> dict:
        account = await self._get("/v1/accounts/me")
        return {k: v for k, v in account.items() if k != "mcp_token"}

    async def decisions(self, limit: int = 20) -> list[dict]:
        events = await self._get("/v1/accounts/me/events") or []
        return [
            {
                "time": e.get("ts"),
                "kind": e.get("kind"),
                "symbol": (e.get("data") or {}).get("symbol"),
                "brain": (e.get("data") or {}).get("brain"),
                "gate": (e.get("data") or {}).get("code"),
                "reason": e.get("msg"),
            }
            for e in events
            if e.get("msg")
        ][: _clamp(limit)]

    async def trades(self, symbol: str | None = None, limit: int = 50) -> list[dict]:
        """Closed round trips, newest first, optionally for one chart symbol."""
        trades = await self._get("/v1/accounts/me/trades") or []
        if symbol:
            want = engine_symbol(symbol)
            trades = [t for t in trades if engine_symbol(t.get("symbol", "")) == want]
        return list(reversed(trades))[: _clamp(limit)]

    async def regimes(self) -> list[dict]:
        return await self._get("/v1/market/regimes") or []
