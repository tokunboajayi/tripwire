import pandas as pd, numpy as np
d=pd.read_csv("fixtures/BTC_daily.csv"); d.index=pd.to_datetime(d.t,unit="s",utc=True); c=d.c
r=c.pct_change().fillna(0); FEE=0.003  # 0.25% fee + 0.05% slip per side
ema=lambda n:c.ewm(span=n,adjust=False).mean(); sma=lambda n:c.rolling(n).mean()
rv=r.rolling(30).std()*np.sqrt(365)
S={ "buy&hold":pd.Series(1.0,c.index),
 "above SMA200":(c>sma(200)).astype(float),
 "above SMA100":(c>sma(100)).astype(float),
 "above EMA50":(c>ema(50)).astype(float),
 "SMA20>SMA100":(sma(20)>sma(100)).astype(float),
 "EMA20>EMA50":(ema(20)>ema(50)).astype(float),
 "SMA20>SMA100, 60% vol":((sma(20)>sma(100))*(0.6/rv).clip(upper=1)),
 "SMA20>SMA100, 1.5x":(sma(20)>sma(100))*1.5,
 "SMA20>SMA100, 2x":(sma(20)>sma(100))*2.0,
 "above SMA200, 2x":(c>sma(200))*2.0,
 "90d momentum>0":(c.pct_change(90)>0).astype(float),
}
def run(w,a,b):
    w=w.shift(1).fillna(0).loc[a:b]; rr=r.loc[a:b]   # trade on yesterday's signal
    cost=w.diff().abs().fillna(w.iloc[0])*FEE
    borrow=(w-1).clip(lower=0)*0.10/365               # 10%/yr on leverage
    eq=(1+w*rr-cost-borrow).cumprod()
    return (eq.iloc[-1]-1)*100,(eq/eq.cummax()-1).min()*100,int((w.diff().abs()>0).sum())
rows=[]
for k,w in S.items():
    f=run(w,"2022-08","2026"); i=run(w,"2022-08","2024"); o=run(w,"2025","2026")
    rows.append([k,round(f[0]),round(f[1]),f[2],round(i[0]),round(o[0]),round(o[1])])
print(pd.DataFrame(rows,columns=["strategy","full%","fullDD%","trades","2022-24%","2025-26%","OOS DD%"]).to_string(index=False))
print(c.index[0].date(),c.index[-1].date())
print("\nRolling 1-year windows from 2022-08 (monthly starts): median / worst / % of windows >= 0")
for k in ["buy&hold","above SMA200","above SMA100","above EMA50","90d momentum>0","above SMA200, 2x"]:
    w=S[k].shift(1).fillna(0); cost=w.diff().abs().fillna(0)*FEE; br=(w-1).clip(lower=0)*0.1/365
    eq=(1+w*r-cost-br).cumprod().loc["2022-08":]
    m=eq.resample("MS").first(); y=(m.shift(-12)/m-1).dropna()*100
    print(f"{k:20s} median {y.median():6.0f}%  worst {y.min():6.0f}%  best {y.max():6.0f}%  positive {100*(y>0).mean():3.0f}%")
