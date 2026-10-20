"""Trend Core: the exact live rule (engine/src/brains.rs). Hold when price > SMA100 * (1+band), sell when < SMA100 * (1-band)
or on a 5-ATR stop. Position = profile max position of the sleeve. Signal on close, fill next open, 0.25% fee + 0.05% slip per side.
Data: backtest/fixtures/BTC_daily.csv (BTC only; ETH/SOL need backtest/fetch.py)."""
import pandas as pd, numpy as np, sys
d = pd.read_csv("fixtures/BTC_daily.csv"); d.index = pd.to_datetime(d.t, unit="s", utc=True)
d["sma100"] = d.c.rolling(100).mean()
FEE, SLIP = 0.0025, 0.0005
def run(a, b, maxpos, band=0.01, stop_atr=5.0):
    R = list(d.loc[a:b].itertuples()); cash = 1.0; pos = None; tr = []; eq = []
    for i in range(len(R) - 1):
        r, n = R[i], R[i + 1]
        if np.isnan(r.sma100) or np.isnan(r.atr): eq.append((r.Index, cash)); continue
        if pos:
            if r.l <= pos["stop"]: px = min(n.o, pos["stop"]); why = "stop"
            elif r.c < r.sma100 * (1 - band): px = n.o; why = "core_end"
            else: px = None
            if px:
                p = pos["q"] * px * (1 - SLIP) * (1 - FEE); cash += p; tr.append(p / pos["c"] - 1); pos = None
        if not pos and r.c > r.sma100 * (1 + band):
            px = n.o * (1 + SLIP); q = cash * maxpos / px; c = q * px * (1 + FEE); cash -= c
            pos = dict(q=q, c=c, stop=px - stop_atr * r.atr)
        eq.append((r.Index, cash + (pos["q"] * r.c if pos else 0)))
    e = pd.Series(dict(eq)); t = np.array(tr)
    return dict(ret=round((e.iloc[-1] - 1) * 100, 1), max_dd=round((e / e.cummax() - 1).min() * 100, 1), trades=len(t),
                win=round((t > 0).mean() * 100) if len(t) else 0)
rows = []
for prof, mp in {"conservative": 0.5, "balanced": 0.75, "aggressive": 1.0}.items():
    for per, (a, b) in {"full 2022-26": ("2022", "2026"), "2025-26": ("2025", "2026")}.items():
        rows.append(dict(profile=prof, period=per, **run(a, b, mp)))
bh = d.c; print(pd.DataFrame(rows).to_string(index=False))
for per, (a, b) in {"full 2022-26": ("2022", "2026"), "2025-26": ("2025", "2026")}.items():
    x = bh.loc[a:b]; print(f"buy&hold {per}: {round((x.iloc[-1]/x.iloc[0]-1)*100,1)}%  max dd {round((x/x.cummax()-1).min()*100,1)}%")
print("band sensitivity (aggressive, full):", {b: run("2022", "2026", 1.0, band=b)["ret"] for b in (0.0, 0.01, 0.02)})
