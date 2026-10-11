"""Read and control the active TradingView chart.

These JS paths are undocumented TradingView Desktop internals and can change on
any app update. Everything that touches them lives in this file.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from .cdp import CDPClient, CDPError, js_str

CHART = "window.TradingViewApi._activeChartWidgetWV.value()"
BARS = f"{CHART}._chartWidget.model().mainSeries().bars()"
MAX_BARS = 2000
READY_TIMEOUT_S = 12.0
READY_POLL_S = 0.25

CHART_TYPES = {"bars": 0, "candles": 1, "line": 2, "area": 3, "heikinashi": 8, "hollowcandles": 9}


def same_resolution(a: str | None, b: str | None) -> bool:
    """TradingView reports "1D" for "D", "1W" for "W", etc."""
    norm = lambda r: str(r).upper().lstrip("1") if str(r).upper() in {"D", "W", "M", "1D", "1W", "1M"} else str(r)
    return norm(a) == norm(b)


def same_symbol(a: str | None, b: str | None) -> bool:
    """Exact match, ignoring case; the exchange prefix only counts when both sides have one.

    BTCUSD vs BTCUSDT or ES1! vs MES1! are different markets, so no substring matching.
    """
    if not a or not b:
        return False
    a, b = a.strip().upper(), b.strip().upper()
    if ":" in a and ":" in b:
        return a == b
    return a.split(":")[-1] == b.split(":")[-1]


def _round(v: float | None) -> float | None:
    return None if v is None else round(v, 8)


class Chart:
    def __init__(self, cdp: CDPClient) -> None:
        self.cdp = cdp
        # setSymbol mutates shared chart state; serialize anything that switches it.
        self.switch_lock = asyncio.Lock()

    async def state(self) -> dict:
        return await self.cdp.evaluate(f"""
          (function() {{
            var c = {CHART};
            var studies = [];
            try {{ studies = c.getAllStudies().map(function(s) {{ return {{ id: s.id, name: s.name }}; }}); }} catch (e) {{}}
            var bars = {BARS};
            return {{
              symbol: c.symbol(), resolution: c.resolution(), chart_type: c.chartType(),
              bars_loaded: bars && bars.size ? bars.size() : 0, studies: studies
            }};
          }})()
        """)

    async def _bar_signature(self) -> list | None:
        return await self.cdp.evaluate(f"""
          (function() {{
            var c = {CHART}, b = {BARS};
            if (!b || typeof b.lastIndex !== 'function' || b.size() === 0) return null;
            var last = b.valueAt(b.lastIndex());
            return [c.symbol(), c.resolution(), b.size(), last ? last[0] : null];
          }})()
        """)

    async def wait_ready(self, away_from: str | None = None, resolution: str | None = None) -> bool:
        """Ready = the chart has left `away_from` (the old symbol), shows `resolution`,
        and its bar data is stable for two polls.

        Waiting for "not the old symbol" rather than "the name we asked for" copes with
        TradingView resolving loose input (BTC -> BITSTAMP:BTCUSD).
        """
        deadline = time.monotonic() + READY_TIMEOUT_S
        prev, stable = None, 0
        while time.monotonic() < deadline:
            sig = await self._bar_signature()
            ok = sig is not None
            if ok and away_from and str(sig[0]).upper() == away_from.upper():
                ok = False
            if ok and resolution and not same_resolution(sig[1], resolution):
                ok = False
            stable = stable + 1 if ok and sig == prev else 0
            if stable >= 2:
                return True
            prev = sig
            await asyncio.sleep(READY_POLL_S)
        return False

    async def set_symbol(self, symbol: str) -> dict:
        before = await self.cdp.evaluate(f"{CHART}.symbol()")
        await self.cdp.evaluate(f"{CHART}.setSymbol({js_str(symbol)}, {{}})")
        ready = await self.wait_ready(away_from=None if same_symbol(symbol, before) else before)
        return {"symbol": await self.cdp.evaluate(f"{CHART}.symbol()"), "chart_ready": ready}

    async def set_timeframe(self, timeframe: str) -> dict:
        await self.cdp.evaluate(f"{CHART}.setResolution({js_str(timeframe)}, {{}})")
        ready = await self.wait_ready(resolution=timeframe)
        return {"timeframe": timeframe, "chart_ready": ready}

    async def set_type(self, chart_type: str) -> dict:
        key = chart_type.replace(" ", "").replace("_", "").lower()
        if key not in CHART_TYPES:
            raise ValueError(f"unknown chart type {chart_type!r}; use one of {sorted(CHART_TYPES)}")
        await self.cdp.evaluate(f"{CHART}.setChartType({CHART_TYPES[key]})")
        return {"chart_type": key}

    async def bars(self, count: int) -> list[dict]:
        count = max(1, min(int(count), MAX_BARS))
        rows = await self.cdp.evaluate(f"""
          (function() {{
            var b = {BARS};
            if (!b || typeof b.lastIndex !== 'function') return null;
            var end = b.lastIndex(), start = Math.max(b.firstIndex(), end - {count} + 1), out = [];
            for (var i = start; i <= end; i++) {{
              var v = b.valueAt(i);
              if (v) out.push({{ time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 }});
            }}
            return out;
          }})()
        """)
        if not rows:
            raise CDPError("No bars on the chart yet; it may still be loading.")
        return rows

    async def quote(self) -> dict:
        q = await self.cdp.evaluate(f"""
          (function() {{
            var c = {CHART}, b = {BARS}, ext = {{}};
            try {{ ext = c.symbolExt() || {{}}; }} catch (e) {{}}
            var last = b && b.size() ? b.valueAt(b.lastIndex()) : null;
            if (!last) return null;
            return {{ symbol: c.symbol(), description: ext.description || null, exchange: ext.exchange || null,
                      time: last[0], open: last[1], high: last[2], low: last[3], last: last[4], volume: last[5] || 0 }};
          }})()
        """)
        if not q:
            raise CDPError("Could not read a quote; the chart may still be loading.")
        return q

    async def study_values(self) -> list[dict]:
        return await self.cdp.evaluate(f"""
          (function() {{
            var src = {CHART}._chartWidget.model().model().dataSources(), out = [];
            for (var i = 0; i < src.length; i++) {{
              var s = src[i];
              if (!s.metaInfo) continue;
              try {{
                var m = s.metaInfo(), name = m.description || m.shortDescription;
                if (!name) continue;
                var vals = {{}}, items = s.dataWindowView().items();
                for (var j = 0; j < items.length; j++) {{
                  var it = items[j];
                  if (it._title && it._value && it._value !== '∅') vals[it._title] = it._value;
                }}
                if (Object.keys(vals).length) out.push({{ id: s.id ? s.id() : null, name: name, values: vals }});
              }} catch (e) {{}}
            }}
            return out;
          }})()
        """) or []

    async def _pine_primitives(self, collection: str, key: str, study_filter: str) -> list[dict]:
        return await self.cdp.evaluate(f"""
          (function() {{
            var src = {CHART}._chartWidget.model().model().dataSources(), out = [], f = {js_str(study_filter)};
            for (var i = 0; i < src.length; i++) {{
              var s = src[i];
              if (!s.metaInfo) continue;
              try {{
                var m = s.metaInfo(), name = m.description || m.shortDescription || '';
                if (!name || (f && name.indexOf(f) === -1)) continue;
                var pc = s._graphics && s._graphics._primitivesCollection;
                var coll = pc && pc[{js_str(collection)}] && pc[{js_str(collection)}].get({js_str(key)});
                coll = coll && coll.get(false);
                if (!coll || !coll._primitivesDataById) continue;
                var items = [];
                coll._primitivesDataById.forEach(function(v) {{ items.push(v); }});
                if (items.length) out.push({{ name: name, items: items }});
              }} catch (e) {{}}
            }}
            return out;
          }})()
        """) or []

    async def pine_levels(self, study_filter: str = "") -> list[dict]:
        raw = await self._pine_primitives("dwglines", "lines", study_filter)
        result = []
        for study in raw:
            levels = sorted(
                {_round(v["y1"]) for v in study["items"] if v.get("y1") is not None and v.get("y1") == v.get("y2")},
                reverse=True,
            )
            result.append({"study": study["name"], "horizontal_levels": levels})
        return result

    async def pine_labels(self, study_filter: str = "", limit: int = 50) -> list[dict]:
        raw = await self._pine_primitives("dwglabels", "labels", study_filter)
        result = []
        for study in raw:
            labels = [{"text": v.get("t", ""), "price": _round(v.get("y"))} for v in study["items"]]
            labels = [lb for lb in labels if lb["text"] or lb["price"] is not None][-limit:]
            result.append({"study": study["name"], "labels": labels})
        return result

    async def chart_clip(self) -> dict | None:
        return await self.cdp.evaluate("""
          (function() {
            var el = document.querySelector('[data-name="pane-canvas"]')
              || document.querySelector('[class*="chart-container"]') || document.querySelector('canvas');
            if (!el) return null;
            var r = el.closest('[class*="chart-container"]') || el;
            var b = r.getBoundingClientRect();
            return { x: b.x, y: b.y, width: b.width, height: b.height };
          })()
        """)

    async def with_symbol(self, symbol: str | None, timeframe: str | None, fn) -> Any:
        """Run fn() with the chart on symbol/timeframe, then put the chart back."""
        async with self.switch_lock:
            before = await self.state()
            changed_sym = bool(symbol) and not same_symbol(symbol, before["symbol"])
            changed_tf = bool(timeframe) and not same_resolution(timeframe, before["resolution"])
            try:
                if changed_sym:
                    await self.set_symbol(symbol)
                if changed_tf:
                    await self.set_timeframe(timeframe)
                return await fn()
            finally:
                if changed_tf:
                    await self.set_timeframe(before["resolution"])
                if changed_sym:
                    await self.set_symbol(before["symbol"])
