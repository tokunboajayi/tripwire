import httpx, pandas as pd, time, sys
def klines(sym, interval="1h", start="2022-01-01"):
    t=int(pd.Timestamp(start,tz="UTC").timestamp()*1000); out=[]
    with httpx.Client(timeout=20) as c:
        while True:
            r=c.get("https://data-api.binance.vision/api/v3/klines",params=dict(symbol=sym,interval=interval,startTime=t,limit=1000)).json()
            if not r: break
            out+=r; t=r[-1][0]+1
            if len(r)<1000: break
    df=pd.DataFrame(out).iloc[:,:6]; df.columns=["t","o","h","l","c","v"]
    df["t"]=pd.to_datetime(df.t,unit="ms",utc=True); df[["o","h","l","c","v"]]=df[["o","h","l","c","v"]].astype(float)
    return df.set_index("t")
for s in ["BTCUSDT","ETHUSDT","SOLUSDT"]:
    d=klines(s); d.to_parquet(f"{s}_1h.parquet"); print(s,len(d),d.index[0],d.index[-1])
