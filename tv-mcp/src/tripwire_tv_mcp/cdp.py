"""Minimal async Chrome DevTools Protocol client for TradingView Desktop.

Only what Tripwire needs: find the chart tab, evaluate JS, take screenshots.
TradingView must be started with --remote-debugging-port (see tv_launch).
"""

from __future__ import annotations

import asyncio
import base64
import itertools
import json
import os
import re
from typing import Any

import httpx
import websockets

CDP_HOST = os.environ.get("TV_CDP_HOST", "127.0.0.1")
CDP_PORT = int(os.environ.get("TV_CDP_PORT", "9222"))
CALL_TIMEOUT_S = 15.0
MAX_MESSAGE_BYTES = 64 * 1024 * 1024

_CHART_URL = re.compile(r"tradingview\.com/chart", re.I)
_ANY_TV_URL = re.compile(r"tradingview", re.I)
_READY_PROBE = (
    "({ready: !!(window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV"
    " && window.TradingViewApi._activeChartWidgetWV.value()),"
    " visible: document.visibilityState === 'visible'})"
)


class CDPError(RuntimeError):
    pass


def js_str(value: Any) -> str:
    """Embed a Python value in JS source as a literal. Never format raw strings into JS."""
    return json.dumps(value)


def pick_chart_target(targets: list[dict]) -> dict | None:
    pages = [t for t in targets if t.get("type") == "page"]
    for pattern in (_CHART_URL, _ANY_TV_URL):
        for t in pages:
            if pattern.search(t.get("url", "")):
                return t
    return None


class CDPClient:
    def __init__(self, host: str = CDP_HOST, port: int = CDP_PORT) -> None:
        self.host = host
        self.port = port
        self._ws: websockets.ClientConnection | None = None
        self._reader: asyncio.Task | None = None
        self._pending: dict[int, asyncio.Future] = {}
        self._ids = itertools.count(1)
        self._connect_lock = asyncio.Lock()
        self.target: dict | None = None

    @property
    def http_base(self) -> str:
        return f"http://{self.host}:{self.port}"

    async def list_targets(self) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as http:
                resp = await http.get(f"{self.http_base}/json/list")
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as exc:
            raise CDPError(
                f"TradingView debug port not reachable at {self.http_base} ({exc}). "
                "Run tv_launch, or start TradingView with --remote-debugging-port="
                f"{self.port}."
            ) from exc

    async def version(self) -> dict:
        async with httpx.AsyncClient(timeout=3.0) as http:
            resp = await http.get(f"{self.http_base}/json/version")
            resp.raise_for_status()
            return resp.json()

    async def _probe(self, target: dict) -> dict | None:
        """Ask a tab whether TradingView's chart API is loaded and whether it's the visible tab."""
        try:
            async with websockets.connect(target["webSocketDebuggerUrl"], max_size=MAX_MESSAGE_BYTES) as ws:
                await ws.send(json.dumps({
                    "id": 1, "method": "Runtime.evaluate",
                    "params": {"expression": _READY_PROBE, "returnByValue": True},
                }))
                msg = json.loads(await asyncio.wait_for(ws.recv(), 3.0))
                return msg.get("result", {}).get("result", {}).get("value")
        except (OSError, asyncio.TimeoutError, websockets.WebSocketException):
            return None

    async def _pick_ready_target(self) -> dict:
        targets = await self.list_targets()
        charts = [t for t in targets if t.get("type") == "page" and _CHART_URL.search(t.get("url", ""))]
        if not charts:
            fallback = pick_chart_target(targets)
            if fallback is None:
                raise CDPError("TradingView is running but no chart tab is open.")
            charts = [fallback]
        ready_hidden = None
        for t in charts:
            probe = await self._probe(t)
            if probe and probe.get("ready"):
                if probe.get("visible"):
                    return t
                ready_hidden = ready_hidden or t
        if ready_hidden:
            return ready_hidden
        raise CDPError("TradingView chart is still loading; retry in a few seconds.")

    async def _connect(self) -> None:
        target = await self._pick_ready_target()
        self._ws = await websockets.connect(
            target["webSocketDebuggerUrl"], max_size=MAX_MESSAGE_BYTES, ping_interval=None
        )
        self.target = target
        self._reader = asyncio.create_task(self._read_loop(self._ws))

    async def reset(self) -> None:
        """Drop the connection so the next call re-picks the chart tab."""
        async with self._connect_lock:
            await self.close()

    async def _read_loop(self, ws: websockets.ClientConnection) -> None:
        try:
            async for raw in ws:
                msg = json.loads(raw)
                fut = self._pending.pop(msg.get("id"), None) if "id" in msg else None
                if fut and not fut.done():
                    fut.set_result(msg)
        except websockets.ConnectionClosed:
            pass
        finally:
            self._fail_pending(CDPError("CDP connection closed"))
            if self._ws is ws:
                self._ws = None

    def _fail_pending(self, exc: Exception) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(exc)
        self._pending.clear()

    async def _ensure(self) -> websockets.ClientConnection:
        async with self._connect_lock:
            if self._ws is None:
                await self._connect()
            return self._ws

    async def send(self, method: str, params: dict | None = None) -> dict:
        ws = await self._ensure()
        msg_id = next(self._ids)
        fut = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = fut
        await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        try:
            msg = await asyncio.wait_for(fut, CALL_TIMEOUT_S)
        except asyncio.TimeoutError as exc:
            self._pending.pop(msg_id, None)
            raise CDPError(f"{method} timed out after {CALL_TIMEOUT_S}s") from exc
        if "error" in msg:
            raise CDPError(f"{method} failed: {msg['error'].get('message')}")
        return msg.get("result", {})

    async def evaluate(self, expression: str, await_promise: bool = False) -> Any:
        try:
            return await self._evaluate_once(expression, await_promise)
        except CDPError as exc:
            # Tab reloaded or we attached mid-load: reconnect to a ready chart tab once.
            if "TradingViewApi" not in str(exc) and "_activeChartWidgetWV" not in str(exc):
                raise
            await self.reset()
            return await self._evaluate_once(expression, await_promise)

    async def _evaluate_once(self, expression: str, await_promise: bool) -> Any:
        result = await self.send(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": await_promise},
        )
        details = result.get("exceptionDetails")
        if details:
            desc = (details.get("exception") or {}).get("description") or details.get("text")
            raise CDPError(f"JS error in TradingView: {desc}")
        return (result.get("result") or {}).get("value")

    async def screenshot(self, clip: dict | None = None) -> bytes:
        params: dict[str, Any] = {"format": "png"}
        if clip:
            params["clip"] = {**clip, "scale": 1}
        result = await self.send("Page.captureScreenshot", params)
        return base64.b64decode(result["data"])

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()
        if self._reader is not None:
            await asyncio.gather(self._reader, return_exceptions=True)
        self._ws = None
