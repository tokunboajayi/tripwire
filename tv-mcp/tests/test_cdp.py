import base64
import json

import pytest
import websockets

from vantrel_tv_mcp.cdp import CDPClient, CDPError, js_str, pick_chart_target


async def fake_devtools(ws):
    async for raw in ws:
        msg = json.loads(raw)
        method, params = msg["method"], msg.get("params", {})
        if method == "Runtime.evaluate" and params["expression"].startswith("({ready"):
            reply = {"result": {"result": {"value": {"ready": True, "visible": True}}}}
        elif method == "Runtime.evaluate" and params["expression"] == "boom":
            reply = {"result": {"exceptionDetails": {"exception": {"description": "ReferenceError: boom"}}}}
        elif method == "Runtime.evaluate":
            reply = {"result": {"result": {"value": {"echo": params["expression"], "await": params["awaitPromise"]}}}}
        elif method == "Page.captureScreenshot":
            reply = {"result": {"data": base64.b64encode(b"PNGDATA").decode()}}
        else:
            reply = {"error": {"message": f"unknown method {method}"}}
        await ws.send(json.dumps({"id": msg["id"], **reply}))


@pytest.fixture
async def client(monkeypatch):
    async with websockets.serve(fake_devtools, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        c = CDPClient(port=port)
        target = {"type": "page", "url": "https://www.tradingview.com/chart/x", "webSocketDebuggerUrl": f"ws://127.0.0.1:{port}"}

        async def targets():
            return [target]

        monkeypatch.setattr(c, "list_targets", targets)
        yield c
        await c.close()


async def test_evaluate_returns_value(client):
    assert await client.evaluate("1+1") == {"echo": "1+1", "await": False}


async def test_evaluate_raises_on_js_exception(client):
    with pytest.raises(CDPError, match="ReferenceError: boom"):
        await client.evaluate("boom")


async def test_protocol_error_surfaces(client):
    with pytest.raises(CDPError, match="unknown method"):
        await client.send("Nope.method")


async def test_screenshot_decodes_png(client):
    assert await client.screenshot() == b"PNGDATA"


async def test_concurrent_calls_are_matched_by_id(client):
    import asyncio

    results = await asyncio.gather(*(client.evaluate(f"x{i}") for i in range(20)))
    assert [r["echo"] for r in results] == [f"x{i}" for i in range(20)]


async def test_unreachable_port_gives_actionable_error():
    with pytest.raises(CDPError, match="tv_launch"):
        await CDPClient(port=1).list_targets()


def test_pick_prefers_chart_tab():
    targets = [
        {"type": "page", "url": "https://www.tradingview.com/"},
        {"type": "page", "url": "https://www.tradingview.com/chart/abc/"},
        {"type": "service_worker", "url": "https://www.tradingview.com/chart/sw"},
    ]
    assert pick_chart_target(targets)["url"].endswith("/chart/abc/")
    assert pick_chart_target([{"type": "page", "url": "about:blank"}]) is None


def test_js_str_escapes_injection():
    payload = "'); alert(1); ('"
    assert js_str(payload) == json.dumps(payload)
    assert json.loads(js_str('a"b\\c')) == 'a"b\\c'
