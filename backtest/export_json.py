"""Write data/backtest.json for the dashboard Backtest page (summary table + weekly equity curves)."""
import pandas as pd, json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
c = pd.read_csv(os.path.join(here, "equity_curves_v2.csv"), index_col=0, parse_dates=True).resample("W").last().dropna()
rows = [l for l in open(os.path.join(here, "results_v2.txt")).read().splitlines()[1:] if l.strip()]
summary = []
for l in rows:
    label, rest = l.split("|")[0].strip(), l.split("|")[1].split()
    summary.append({"profile": label.replace("v2 ", ""), "period": rest[0] + (" " + rest[1] if not rest[1][0].isdigit() and rest[1] != "full" else ""),
                    "raw": l.strip()})
out = {"curves": {k: [[int(t.timestamp()), round(float(v), 4)] for t, v in c[k].items()] for k in c.columns},
       "rows": [l.strip() for l in rows], "fee_per_side": 0.0025, "assets": ["BTC", "ETH", "SOL"],
       "headline": {"oos_market": -27.5, "oos_conservative": 0.4, "oos_aggressive": 1.5, "maxdd_conservative": -17.4, "maxdd_buy_hold": -75.8,
                    "win_rate": 45.9, "breakeven_win_rate": 35.9, "trades": 98}}
os.makedirs(os.path.join(here, "..", "data"), exist_ok=True)
json.dump(out, open(os.path.join(here, "..", "data", "backtest.json"), "w")); print("wrote data/backtest.json")
