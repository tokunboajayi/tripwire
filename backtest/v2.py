"""v2: trend sleeve uses vol-targeted sizing + EMA50 exit; MR/breakout unchanged."""
import pandas as pd, numpy as np, backtest as B, daily as D
B.FEE=0.0025; TV=0.40  # target annual vol for trend sleeve
coins=["BTCUSDT","ETHUSDT","SOLUSDT"]; data={s:D.prep(s) for s in coins}
for s,d in data.items(): d["rv"]=d.c.pct_change().rolling(30).std()*np.sqrt(365)
def run(d,a,b,risk,maxpos,tv):
    R=list(d.loc[a:b].itertuples()); cash=1.0; pos=None; tr=[]; eq=[]
    for i in range(len(R)-1):
        r,n=R[i],R[i+1]
        if np.isnan(r.ema200) or np.isnan(r.atrp_rank) or np.isnan(r.rv): continue
        reg=D.regime(r)
        if pos:
            b_=pos["b"]; ex=False; pos["hi"]=max(pos["hi"],r.c)
            if r.l<=pos["stop"]: ex=True; px=min(n.o,pos["stop"])
            elif b_=="MR" and (r.c>r.sma5 or i-pos["i"]>=10): ex=True; px=n.o
            elif b_=="TREND" and r.c<r.ema50: ex=True; px=n.o
            elif b_=="BREAKOUT": pos["stop"]=max(pos["stop"],pos["hi"]-2*r.atr)
            if ex:
                p=pos["q"]*px*(1-B.SLIP)*(1-B.FEE); cash+=p; tr.append(dict(b=b_,ret=p/pos["c"]-1,pnl=p-pos["c"])); pos=None
        if not pos:
            px=n.o*(1+B.SLIP); q=0
            if reg=="TREND_UP" and r.c>r.ema50 and r.ema50>r.ema200:
                b_="TREND"; frac=min(maxpos, tv/r.rv); q=cash*frac/px; stop=px-4*r.atr
            elif reg=="RANGE" and r.rsi2<10 and r.c>r.sma200:
                b_="MR"; stop=px-3*r.atr; q=min(cash*risk/(3*r.atr),cash*maxpos/px)
            elif reg=="HIGH_VOL" and r.c>r.dch10 and r.v>1.5*r.vol20 and r.c>r.ema50:
                b_="BREAKOUT"; stop=px-2*r.atr; q=min(cash*risk/(2*r.atr),cash*maxpos/px)
            if q>0:
                c=q*px*(1+B.FEE); cash-=c; pos=dict(b=b_,q=q,c=c,stop=stop,hi=px,i=i)
        eq.append((r.Index,cash+(pos["q"]*r.c if pos else 0)))
    return pd.Series(dict(eq)),pd.DataFrame(tr)
rows=[];curves={}
for prof,(risk,maxpos,tv) in {"conservative":(0.01,0.5,0.25),"balanced":(0.02,0.75,0.40),"aggressive":(0.03,1.0,0.60)}.items():
    for per,(a,b) in {"design 2022-24":("2022","2024"),"OOS 2025-26":("2025","2026"),"full":("2022","2026")}.items():
        E=[];T=[]
        for s in coins: e,t=run(data[s],a,b,risk,maxpos,tv); E.append(e/e.iloc[0]); T.append(t)
        eq=pd.concat(E,axis=1).ffill().mean(axis=1); t=pd.concat(T)
        bh=pd.concat([data[s].loc[a:b].c for s in coins],axis=1).loc[eq.index[0]:]; bh=(bh/bh.iloc[0]).mean(axis=1)
        st=B.stats(eq,t,f"v2 {prof} | {per}"); st["bh_ret"]=round((bh.iloc[-1]-1)*100,1); st["bh_dd"]=round((bh/bh.cummax()-1).min()*100,1)
        st["by_brain_wr"]={k:round((g.pnl>0).mean()*100) for k,g in t.groupby("b")}; rows.append(st)
        if per=="full": curves[prof]=eq; curves["buy_hold"]=bh
print(pd.DataFrame(rows).to_string(index=False)); pd.DataFrame(curves).to_csv("equity_curves_v2.csv")
