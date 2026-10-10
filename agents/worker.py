"""Tripwire AI agents: Regime Agent (Sonnet), Thesis Agent (Haiku), daily digest.
The engine never waits on these. If anything fails, Rust keeps trading on its deterministic regime."""
import os, json, re, time, hashlib, pathlib, datetime as dt
import httpx
from pydantic import BaseModel, Field
from prompts import REGIME, THESIS, VERDICT, DIGEST

API = os.getenv("TRIPWIRE_API", "http://localhost:8080")
H = {"x-internal-token": os.getenv("INTERNAL_TOKEN", "change-me")}
SONNET = os.getenv("REGIME_MODEL", "claude-sonnet-5-5"); HAIKU = os.getenv("THESIS_MODEL", "claude-haiku-5-5")
CACHE = pathlib.Path(os.getenv("AGENT_CACHE", ".cache")); CACHE.mkdir(exist_ok=True)
http = httpx.Client(timeout=20)
try:
    import anthropic; llm = anthropic.Anthropic() if os.getenv("ANTHROPIC_API_KEY") else None
except Exception: llm = None

class RegimeCall(BaseModel): regime: str; confidence: float = Field(ge=0, le=1); reason: str
class Thesis(BaseModel): reason: str; invalidation: list[str]; confidence: float = Field(ge=0, le=1)
class Verdict(BaseModel): verdict: str; confidence: float = Field(ge=0, le=1); evidence: str

def last_json(text: str) -> dict: return json.loads(re.findall(r"\{.*\}", text, re.S)[-1])

def ask(model: str, prompt: str, max_tokens=400) -> str:
    key = CACHE / hashlib.sha256((model + prompt).encode()).hexdigest()
    if key.exists(): return key.read_text()
    out = llm.messages.create(model=model, max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}]).content[0].text
    key.write_text(out); return out

def news(symbols: list[str]) -> list[dict]:
    k, s = os.getenv("APCA_API_KEY_ID"), os.getenv("APCA_API_SECRET_KEY")
    if not (k and s): return []
    try:
        r = http.get("https://data.alpaca.markets/v1beta1/news", params={"symbols": ",".join(f"{x}USD" for x in symbols), "limit": 20},
                     headers={"APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s}).json()
        return [{"id": n["id"], "headline": n["headline"], "symbols": [x.replace("USD", "") for x in n.get("symbols", [])]} for n in r.get("news", [])]
    except Exception as e: print("news error", e); return []

def regime_round():
    snap = http.get(f"{API}/internal/snapshot", headers=H).json()
    heads = news([m["symbol"] for m in snap])
    for m in snap:
        hl = [n["headline"] for n in heads if m["symbol"] in n["symbols"]][:5] or ["(none)"]
        prompt = REGIME.format(det=m["deterministic"], symbol=m["symbol"], snapshot=json.dumps({"price": m["price"], **m["indicators"]}), headlines=hl)
        text = ""
        with llm.messages.stream(model=SONNET, max_tokens=500, messages=[{"role": "user", "content": prompt}]) as s:
            buf = ""
            for tok in s.text_stream:
                text += tok; buf += tok
                if len(buf) > 40 or "\n" in buf:  # stream reasoning to the dashboard in small chunks
                    http.post(f"{API}/internal/stream", headers=H, json={"symbol": m["symbol"], "text": buf}); buf = ""
        call = RegimeCall(**last_json(text))
        r = http.post(f"{API}/internal/regime", headers=H, json={"symbol": m["symbol"], **call.model_dump()}).json()
        print("regime", m["symbol"], call.regime, "->", r)

def thesis_round(seen: set):
    pos = http.get(f"{API}/internal/positions", headers=H).json()
    if not pos: return
    snap = {m["symbol"]: m for m in http.get(f"{API}/internal/snapshot", headers=H).json()}
    heads = news(sorted({p["symbol"] for p in pos}))
    for p in pos:
        sym = p["symbol"]; hl = [n for n in heads if sym in n["symbols"]]
        if not p["thesis"]:
            t = Thesis(**last_json(ask(HAIKU, THESIS.format(symbol=sym, brain=p["brain"], regime=p["regime"], snapshot=json.dumps(snap[sym]["indicators"]), headlines=[n["headline"] for n in hl[:5]]))))
            http.post(f"{API}/internal/thesis", headers=H, json={"account": p["account"], "symbol": sym, **t.model_dump()}); continue
        for n in hl:
            k = (p["account"], sym, n["id"])
            if k in seen: continue
            seen.add(k)
            v = Verdict(**last_json(ask(HAIKU, VERDICT.format(symbol=sym, reason=p["thesis"]["reason"], invalidation="; ".join(p["thesis"]["invalidation"]), headline=n["headline"]))))
            if v.verdict == "break" and v.confidence >= 0.7:
                http.post(f"{API}/internal/exit", headers=H, json={"account": p["account"], "symbol": sym, "evidence": v.evidence}); break

def digest_round():
    for a in http.get(f"{API}/internal/accounts", headers=H).json():
        stats = {"pnl_today": round(a["pnl_today"], 2), "equity": round(a["equity"], 2), "positions": [p["symbol"] + " " + p["brain_label"] for p in a["positions"]],
                 "closed_today": [f'{t["symbol"]} {t["reason"]} {t["ret"]:+.1%}' for t in a["trades_today"]]}
        http.post(f"{API}/internal/digest", headers=H, json={"account": a["user"], "text": ask(HAIKU, DIGEST.format(stats=json.dumps(stats)), 200).strip()})

def main():
    if not llm: print("No ANTHROPIC_API_KEY: agents idle, engine runs on deterministic regimes."); 
    last = {"regime": 0, "thesis": 0, "digest": ""}; seen = set()
    while True:
        now = time.time(); et = dt.datetime.now(dt.timezone(dt.timedelta(hours=-4)))
        for name, every, fn in [("regime", 900, regime_round), ("thesis", 60, lambda: thesis_round(seen))]:
            if llm and now - last[name] >= every:
                last[name] = now
                try: fn()
                except Exception as e: print(name, "error (engine falls back):", e)
        if llm and et.hour == 20 and last["digest"] != et.date().isoformat():
            last["digest"] = et.date().isoformat()
            try: digest_round()
            except Exception as e: print("digest error", e)
        time.sleep(10)

if __name__ == "__main__": main()
