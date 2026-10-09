import pandas as pd, numpy as np, backtest as B, daily as D, json
B.FEE=0.0025
coins=["BTCUSDT","ETHUSDT","SOLUSDT"]; data={s:D.prep(s) for s in coins}
rows=[]; curves={}
for prof,(risk,maxpos) in {"conservative":(0.01,0.5),"balanced":(0.02,0.75),"aggressive":(0.03,1.0)}.items():
    B.RISK=risk; B.MAXPOS=maxpos
    for per,(a,b) in {"design 2022-24":("2022","2024"),"out-of-sample 2025-26":("2025","2026"),"full":("2022","2026")}.items():
        eqs=[];T=[]
        for s in coins:
            e,t=B.run(data[s],"regime",a,b); eqs.append(e/e.iloc[0]); T.append(t)
        eq=pd.concat(eqs,axis=1).ffill().mean(axis=1); t=pd.concat(T)
        bh=pd.concat([data[s].loc[a:b].c/data[s].loc[a:b].c.dropna().iloc[0] for s in coins],axis=1).loc[eq.index[0]:].mean(axis=1)
        bh=bh/bh.iloc[0]
        st=B.stats(eq,t,f"{prof} | {per}")
        st["buy_hold_ret"]=round((bh.iloc[-1]-1)*100,1); st["buy_hold_dd"]=round((bh/bh.cummax()-1).min()*100,1)
        rows.append(st)
        if per=="full": curves[prof]=eq; curves["buy_hold"]=bh
print(pd.DataFrame(rows).to_string(index=False))
pd.DataFrame(curves).to_csv("equity_curves.csv")
