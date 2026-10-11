"""Vantrel three-brain regime backtest. Long-only, next-bar-open fills, fees+slippage."""
import pandas as pd, numpy as np, sys, json
FEE=0.0025; SLIP=0.0005  # per side (Alpaca crypto taker tier ~0.25%; verify)
RISK=0.01; MAXPOS=0.5; WARM=1

def ind(d):
    c,h,l=d.c,d.h,d.l
    tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1)
    d["atr"]=tr.ewm(alpha=1/14,adjust=False).mean()
    d["ema50"]=c.ewm(span=50,adjust=False).mean(); d["ema200"]=c.ewm(span=200,adjust=False).mean()
    up=h.diff(); dn=-l.diff()
    pdm=np.where((up>dn)&(up>0),up,0.); ndm=np.where((dn>up)&(dn>0),dn,0.)
    pdi=100*pd.Series(pdm,d.index).ewm(alpha=1/14,adjust=False).mean()/d.atr
    ndi=100*pd.Series(ndm,d.index).ewm(alpha=1/14,adjust=False).mean()/d.atr
    d["adx"]=(100*(pdi-ndi).abs()/(pdi+ndi)).ewm(alpha=1/14,adjust=False).mean()
    g=c.diff(); rs=g.clip(lower=0).ewm(alpha=1/2,adjust=False).mean()/(-g.clip(upper=0)).ewm(alpha=1/2,adjust=False).mean()
    d["rsi2"]=100-100/(1+rs)
    d["sma5"]=c.rolling(5).mean()
    d["dch20"]=h.rolling(20).max().shift(); d["dch10"]=h.rolling(10).max().shift()
    d["vol20"]=d.v.rolling(20).mean()
    d["atrp"]=d.atr/c; d["atrp_rank"]=d.atrp.rolling(90*6 if len(d)<20000 else 90*24).rank(pct=True)
    return d

def regime(r):
    if r.atrp_rank>0.85: return "HIGH_VOL"
    if r.adx>25 and r.c>r.ema200 and r.ema50>r.ema200: return "TREND_UP"
    if r.adx>25 and r.c<r.ema200: return "TREND_DOWN"
    return "RANGE"

def entry(brain,r):
    if brain=="MR": return r.rsi2<10, 2.5
    if brain=="TREND": return r.c>r.dch20, 3.0
    if brain=="BREAKOUT": return (r.c>r.dch10) and (r.v>1.5*r.vol20) and (r.c>r.ema50), 2.0
    return False,0

ROUTE={"RANGE":"MR","TREND_UP":"TREND","HIGH_VOL":"BREAKOUT","TREND_DOWN":"MR_DEF"}

def run(d, mode="regime", start=None, end=None, cash0=10_000):
    d=d.loc[start:end] if start or end else d
    rows=d.itertuples(); cash=cash0; pos=None; trades=[]; eq=[]
    R=list(d.itertuples())
    for i in range(WARM,len(R)-1):
        r=R[i]; nxt=R[i+1]
        if np.isnan(r.ema200) or np.isnan(r.atrp_rank): continue
        reg=regime(r)
        if pos:  # manage exit on this bar's close, fill next open
            b=pos["brain"]; ex=False
            pos["hi"]=max(pos["hi"],r.c)
            if r.l<=pos["stop"]: ex="stop"; px=min(nxt.o,pos["stop"])
            elif b in("MR","MR_DEF") and (r.c>r.sma5 or i-pos["i"]>=48): ex="target"
            elif b=="TREND": 
                pos["stop"]=max(pos["stop"],pos["hi"]-3*r.atr)
                if mode=="regime" and reg=="TREND_DOWN": ex="regime"
            elif b=="BREAKOUT": pos["stop"]=max(pos["stop"],pos["hi"]-2*r.atr)
            if ex:
                px=(px if ex=="stop" else nxt.o)*(1-SLIP)
                proceeds=pos["q"]*px*(1-FEE); cash+=proceeds
                trades.append(dict(brain=b,reg=pos["reg"],pnl=proceeds-pos["cost"],ret=proceeds/pos["cost"]-1,why=ex,t=nxt.Index))
                pos=None
        if not pos:
            brain = ROUTE[reg] if mode=="regime" else mode
            if brain=="CASH": ok,k=False,0; risk=0
            elif brain=="MR_DEF": ok,k=entry("MR",r); risk=RISK*0.5
            else: ok,k=entry(brain,r); risk=RISK
            if ok:
                px=nxt.o*(1+SLIP); stopd=k*r.atr
                q=min(cash*risk/stopd, cash*MAXPOS/px)
                cost=q*px*(1+FEE); cash-=cost
                pos=dict(brain=brain,reg=reg,q=q,cost=cost,stop=px-stopd,hi=px,i=i)
        eq.append((r.Index, cash+(pos["q"]*r.c if pos else 0)))
    e=pd.Series(dict(eq)); t=pd.DataFrame(trades)
    return e,t

def stats(e,t,label):
    if t.empty: return dict(label=label,trades=0)
    w=t[t.pnl>0]; l=t[t.pnl<=0]
    aw=w.ret.mean() if len(w) else 0; al=-l.ret.mean() if len(l) else 0
    wr=len(w)/len(t); exp=t.ret.mean()
    dd=(e/e.cummax()-1).min()
    return dict(label=label,trades=len(t),win_rate=round(wr*100,1),avg_win=round(aw*100,2),avg_loss=round(al*100,2),
        breakeven_wr=round(al/(aw+al)*100,1) if aw+al else None,expectancy=round(exp*100,3),
        total_return=round((e.iloc[-1]/e.iloc[0]-1)*100,1),max_dd=round(dd*100,1))

if __name__=="__main__":
    tf=sys.argv[1] if len(sys.argv)>1 else "1h"
    out=[]
    for s in ["BTCUSDT","ETHUSDT"]:
        d=pd.read_parquet(f"{s}_1h.parquet")
        if tf!="1h": d=d.resample(tf).agg(dict(o="first",h="max",l="min",c="last",v="sum")).dropna()
        d=ind(d)
        for per,(a,b) in {"2022-2024 (design)":("2022","2024"),"2025-2026 (out-of-sample)":("2025","2026"),"full":(None,None)}.items():
            for mode in ["regime","MR","TREND","BREAKOUT"]:
                e,t=run(d,mode,a,b); st=stats(e,t,f"{s} {tf} {per} {mode}")
                bh=d.loc[a:b].c; st["buy_hold"]=round((bh.iloc[-1]/bh.iloc[250]-1)*100,1)
                out.append(st)
    df=pd.DataFrame(out); pd.set_option("display.width",250); print(df.to_string(index=False))
