"""Fetch daily stock bars from Alpaca (free IEX feed) → data/stocks.json for the stock replay.
Needs APCA_API_KEY_ID / APCA_API_SECRET_KEY in the environment. Usage: python data/fetch_stocks.py"""
import os, json, httpx, datetime as dt
SYMS = os.getenv("STOCK_SYMBOLS", "AAPL,MSFT,NVDA,AMZN,SPY").split(",")
H = {"APCA-API-KEY-ID": os.environ["APCA_API_KEY_ID"], "APCA-API-SECRET-KEY": os.environ["APCA_API_SECRET_KEY"]}
out = {s: [] for s in SYMS}; token = None
while True:
    p = {"symbols": ",".join(SYMS), "timeframe": "1Day", "start": "2021-01-01", "limit": 10000, "feed": "iex", "adjustment": "all"}
    if token: p["page_token"] = token
    r = httpx.get("https://data.alpaca.markets/v2/stocks/bars", params=p, headers=H, timeout=30).json()
    for s, bars in (r.get("bars") or {}).items():
        out[s] += [{"t": int(dt.datetime.fromisoformat(b["t"].replace("Z", "+00:00")).timestamp()), "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]} for b in bars]
    token = r.get("next_page_token")
    if not token: break
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stocks.json")
json.dump(out, open(path, "w")); print({s: len(v) for s, v in out.items()}, "->", path)
