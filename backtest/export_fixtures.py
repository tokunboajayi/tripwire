"""Export Python-reference indicators + regime per daily bar → fixtures/<SYM>_daily.csv (Rust parity test)."""
import pandas as pd, numpy as np, daily as D, os
os.makedirs("fixtures", exist_ok=True)
for s in ["BTCUSDT"]:
    d = D.prep(s); d["rv"] = d.c.pct_change().rolling(30).std() * np.sqrt(365)
    reg = [D.regime(r) if not (np.isnan(r.ema200) or np.isnan(r.atrp_rank) or np.isnan(r.rv) or np.isnan(r.sma200)) else "" for r in d.itertuples()]
    out = pd.DataFrame({"t": (d.index - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta("1s"), "o": d.o, "h": d.h, "l": d.l, "c": d.c, "v": d.v, "atr": d.atr, "ema50": d.ema50, "ema200": d.ema200,
        "sma200": d.sma200, "sma5": d.sma5, "adx": d.adx, "rsi2": d.rsi2, "dch10": d.dch10, "dch20": d.dch20, "vol20": d.vol20, "rv": d.rv, "atrp_rank": d.atrp_rank, "regime": reg})
    out.to_csv(f"fixtures/{s[:3]}_daily.csv", index=False, float_format="%.12g"); print(s, len(out))
