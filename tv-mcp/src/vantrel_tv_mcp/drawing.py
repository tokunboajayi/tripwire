"""Draw Vantrel's decisions onto the TradingView chart.

Every shape created here is tracked, so clear_vantrel only removes Vantrel's
own drawings and never the user's.
"""

from __future__ import annotations

import math

from .cdp import CDPClient, js_str
from .chart import CHART

TAG = "TW"
COLORS = {"buy": "#22c55e", "sell": "#ef4444", "stop": "#f97316", "target": "#3b82f6", "note": "#a855f7"}
# Keyed by the engine's brain codes (see regime.BRAIN_BY_REGIME).
BRAIN_COLORS = {"MR": "#3b82f6", "TREND": "#22c55e", "BREAKOUT": "#eab308", "SHIELD": "#94a3b8"}


def brain_color(brain: str | None) -> str:
    return BRAIN_COLORS.get((brain or "").upper(), COLORS["note"])


def _finite(value: float, name: str) -> float:
    v = float(value)
    if not math.isfinite(v):
        raise ValueError(f"{name} must be a finite number, got {value!r}")
    return v


def _unix_seconds(t: float) -> int:
    """Accept seconds or milliseconds; TradingView shapes want seconds."""
    t = _finite(t, "time")
    return int(t / 1000) if t > 1e11 else int(t)


class Drawer:
    def __init__(self, cdp: CDPClient) -> None:
        self.cdp = cdp
        self.created: list[str] = []

    async def _create(self, time_s: int, price: float, shape: str, text: str, overrides: dict) -> str | None:
        # createShape returns an id on older builds and a Promise of one on newer builds.
        shape_id = await self.cdp.evaluate(f"""
          Promise.resolve({CHART}.createShape(
            {{ time: {time_s}, price: {price} }},
            {{ shape: {js_str(shape)}, text: {js_str(text)}, overrides: {js_str(overrides)},
               disableSave: true, lock: true }}
          )).then(function(id) {{ return id ? String(id) : null; }})
        """, await_promise=True)
        if shape_id:
            self.created.append(shape_id)
        return shape_id

    async def trade_marker(self, time: float, price: float, side: str, text: str = "") -> dict:
        side = side.lower()
        if side not in ("buy", "sell"):
            raise ValueError("side must be 'buy' or 'sell'")
        shape = "arrow_up" if side == "buy" else "arrow_down"
        label = f"{TAG} {side.upper()} {text}".strip()
        shape_id = await self._create(
            _unix_seconds(time), _finite(price, "price"), shape, label, {"color": COLORS[side]}
        )
        return {"entity_id": shape_id, "shape": shape, "text": label}

    async def level(self, price: float, kind: str = "note", text: str = "") -> dict:
        kind = kind.lower()
        if kind not in COLORS:
            raise ValueError(f"kind must be one of {sorted(COLORS)}")
        now = await self.cdp.evaluate(f"(function(){{var b={CHART}._chartWidget.model().mainSeries().bars();"
                                      f"var v=b.valueAt(b.lastIndex());return v?v[0]:null;}})()")
        label = f"{TAG} {kind.upper()} {text}".strip()
        shape_id = await self._create(
            int(now or 0), _finite(price, "price"), "horizontal_line", label,
            {"linecolor": COLORS[kind], "linewidth": 2, "showLabel": True, "textcolor": COLORS[kind]},
        )
        return {"entity_id": shape_id, "kind": kind, "price": price, "text": label}

    async def note(self, time: float, price: float, text: str, brain: str | None = None) -> dict:
        color = brain_color(brain)
        label = f"{TAG} {text}"
        shape_id = await self._create(
            _unix_seconds(time), _finite(price, "price"), "text", label,
            {"color": color, "fontsize": 12, "bold": True},
        )
        return {"entity_id": shape_id, "text": label}

    async def clear_vantrel(self) -> dict:
        # Tracked ids cover this session; the TAG prefix sweep covers drawings
        # left over from a previous server run.
        ids = list(self.created)
        removed = await self.cdp.evaluate(f"""
          (function() {{
            var api = {CHART}, mine = {{}}, prefix = {js_str(TAG + " ")}, n = 0;
            {js_str(ids)}.forEach(function(id) {{ mine[id] = true; }});
            api.getAllShapes().forEach(function(s) {{
              var id = String(s.id), text = '';
              try {{ text = api.getShapeById(s.id).getProperties().text || ''; }} catch (e) {{}}
              if (mine[id] || text.indexOf(prefix) === 0) {{ api.removeEntity(s.id); n++; }}
            }});
            return n;
          }})()
        """)
        self.created = []
        return {"removed": removed or 0}
