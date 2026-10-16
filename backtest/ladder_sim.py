"""Growth Ladder overlay on the v2 equity curves (same rules as engine/src/ladder.rs).
Start at $200 allowed; raise at most 2x per 30 days when every gate passes; a 10% drawdown on the rung halts buys.
Only `allowed` dollars trade; deposits and the rest sit in cash. Fills are estimated at v2's average rate
(98 round trips over the full period = 2 fills each), because the curves don't carry per-trade timestamps."""
import pandas as pd, numpy as np, sys

C = pd.read_csv("equity_curves_v2.csv", index_col=0, parse_dates=True)
START, CAP, RESUME_DAYS = 200.0, 10_000.0, 7
FILL_RATE = 2 * 98 / len(C)          # fills per day, full period average

def sim(curve, monthly, ladder=True):
    r = curve.pct_change().fillna(0).values; days = curve.index
    traded = START; cash = 0.0; allowed = START
    rung_start = 0; last_raise = -10**9; fills = 0.0; peak = traded; start_eq = traded; dd = 0.0
    halted_until = -1; stops = 0; raises = []; deposits = START; month = days[0].month
    for i in range(1, len(r)):
        if days[i].month != month:           # monthly deposit lands in cash
            month = days[i].month; cash += monthly; deposits += monthly
            if not ladder: traded += cash; cash = 0.0
        if i <= halted_until: continue       # halted: flat, earns nothing
        traded *= 1 + r[i]; fills += FILL_RATE if r[i] != 0 else FILL_RATE / 2
        if not ladder: continue
        peak = max(peak, traded); cur_dd = 1 - traded / peak; dd = max(dd, cur_dd)
        if cur_dd >= 0.10:                   # LADDER_STOP: halt; owner resumes after RESUME_DAYS
            stops += 1; halted_until = i + RESUME_DAYS; peak = traded   # rung's max drawdown stays >= 10%,
            continue                                                    # so no raise is possible on this rung (as in ladder.rs)
        gates = (i - rung_start >= 30 and i - last_raise >= 30 and fills >= 10 and dd < 0.10 and traded >= start_eq)
        if gates and allowed < CAP:
            new = min(allowed * 2, CAP, traded + cash)
            if new > traded:
                cash -= new - traded; traded = new; raises.append((days[i].date(), round(new)))
                allowed = new; rung_start = last_raise = i; fills = 0; peak = start_eq = traded; dd = 0.0
    end = traded + cash
    return dict(end=round(end), deposits=round(deposits), profit=round(end - deposits),
                traded_end=round(traded), raises=len(raises), stops=stops,
                first_raise=raises[0][0] if raises else None, last_rung=round(allowed))

def bh(curve, monthly):  # buy & hold with the same deposits
    r = curve.pct_change().fillna(0).values; v = START; dep = START; m = curve.index[0].month
    for i in range(1, len(r)):
        if curve.index[i].month != m: m = curve.index[i].month; v += monthly; dep += monthly
        v *= 1 + r[i]
    return dict(end=round(v), deposits=round(dep), profit=round(v - dep))

rows = []
for per, (a, b) in {"full 2022-26": ("2022", "2026"), "OOS 2025-26": ("2025", "2026")}.items():
    c = C.loc[a:b]
    for monthly in (0, 100, 500):
        for prof in ("conservative", "balanced", "aggressive"):
            L = sim(c[prof], monthly); N = sim(c[prof], monthly, ladder=False)
            rows.append(dict(period=per, monthly=monthly, profile=prof, **{f"ladder_{k}": v for k, v in L.items()},
                             no_ladder_end=N["end"], no_ladder_profit=N["profit"]))
        B = bh(c["buy_hold"], monthly)
        rows.append(dict(period=per, monthly=monthly, profile="buy_hold", ladder_end=B["end"], ladder_deposits=B["deposits"], ladder_profit=B["profit"]))
df = pd.DataFrame(rows)
pd.set_option("display.width", 250)
print(df.to_string(index=False))
df.to_csv("results_ladder.csv", index=False)
