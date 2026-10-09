import pandas as pd, numpy as np, backtest as B, sys
TF="1D"; BPD=1
def prep(s):
    d=pd.read_parquet(f"{s}_1h.parquet").resample(TF).agg(dict(o="first",h="max",l="min",c="last",v="sum")).dropna()
    d=B.ind(d); d["atrp_rank"]=d.atrp.rolling(90*BPD,min_periods=30*BPD).rank(pct=True); d["sma200"]=d.c.rolling(200).mean(); return d
def entry(brain,r):
    if brain=="MR": return (r.rsi2<10) and (r.c>r.sma200), 3.0
    if brain=="TREND": return (r.c>r.dch20) and (r.ema50>r.ema200), 3.0
    if brain=="BREAKOUT": return (r.c>r.dch10) and (r.v>1.5*r.vol20) and (r.c>r.ema50), 2.0
    return False,0
def regime(r):
    if r.atrp_rank>0.85: return "HIGH_VOL"
    if r.adx>25 and r.c>r.ema200 and r.ema50>r.ema200: return "TREND_UP"
    if r.c<r.sma200: return "TREND_DOWN"
    return "RANGE"
B.entry=entry; B.regime=regime; B.ROUTE={"RANGE":"MR","TREND_UP":"TREND","HIGH_VOL":"BREAKOUT","TREND_DOWN":"CASH"}
if __name__=='__main__':
  B.FEE=float(sys.argv[1]) if len(sys.argv)>1 else 0.0025
  out=[]
  for s in ["BTCUSDT","ETHUSDT","SOLUSDT"]:
      d=prep(s)
      for per,(a,b) in {"design 22-24":("2022","2024"),"OOS 25-26":("2025","2026")}.items():
          bh=d.loc[a:b].c.dropna()
          for mode in ["regime","MR","TREND","BREAKOUT"]:
              e,t=B.run(d,mode,a,b); st=B.stats(e,t,f"{s[:3]} {TF} {per} {mode}"); st["buy_hold"]=round((bh.iloc[-1]/bh.iloc[0]-1)*100,1); out.append(st)
  print(pd.DataFrame(out).to_string(index=False))
  