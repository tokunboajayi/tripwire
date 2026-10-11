"""Live price stream + ElevenLabs voice, against a real engine binary and fake upstreams (no keys, no internet).

    python tests/live_feed.py engine/target/release/vantrel-engine

Starts a fake Binance klines API whose price moves on every request and a fake ElevenLabs TTS API,
launches the engine against them, then checks: live feed, SSE `tick` stream with moving prices,
candles following the ticks, and the voice proxy (key stays server-side, audio comes back)."""
import json, os, random, socket, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import httpx

httpx = httpx.Client(trust_env=False, timeout=30)  # talk to local servers directly, never via a proxy
import httpx as _httpx

ENGINE = os.path.abspath(sys.argv[1])
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

# ---- fake Binance: 700 daily bars of history, today's bar moves on every poll ----
DAY = 86400; TODAY = int(time.time()) // DAY * DAY
price = {"BTC": 60000.0, "ETH": 3000.0}
hist = {}
for sym, p0 in list(price.items()):
    p, bars = p0, []
    for i in range(700, 0, -1):
        o = p; p *= 1 + random.uniform(-0.03, 0.032)
        bars.append([(TODAY - i * DAY) * 1000, o, max(o, p) * 1.01, min(o, p) * 0.99, p, 1000 + random.random() * 500])
    hist[sym] = bars; price[sym] = p
polls = {"n": 0}
def kline(t, o, h, l, c, v): return [t, f"{o:.2f}", f"{h:.2f}", f"{l:.2f}", f"{c:.2f}", f"{v:.2f}", t + DAY * 1000 - 1]
class Market(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query); sym = q["symbol"][0].replace("USDT", "")
        if "startTime" in q:
            start = int(q["startTime"][0]); rows = [kline(*b) for b in hist[sym] if b[0] >= start][:1000]
        else:
            polls["n"] += 1
            last = hist[sym][-1][4]
            price[sym] = price[sym] * (1 + random.uniform(-0.004, 0.004)) + 0.01  # always moves
            o = last; c = price[sym]
            rows = [kline(*hist[sym][-2]), kline(*hist[sym][-1]), kline(TODAY * 1000, o, max(o, c) * 1.002, min(o, c) * 0.998, c, 800.0)]
        body = json.dumps(rows).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(body)

# ---- fake ElevenLabs ----
tts = []
class Voice(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        tts.append({"path": self.path, "key": self.headers.get("xi-api-key"), **body})
        if self.headers.get("xi-api-key") != "test-key":
            self.send_response(401); self.end_headers(); return
        audio = b"ID3" + b"\x00" * 64
        self.send_response(200); self.send_header("content-type", "audio/mpeg"); self.send_header("content-length", str(len(audio))); self.end_headers(); self.wfile.write(audio)

mp, vp, ep = free_port(), free_port(), free_port()
for port, h in ((mp, Market), (vp, Voice)):
    threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", port), h).serve_forever, daemon=True).start()

data = tempfile.mkdtemp(prefix="vt-live-")
env = {**os.environ, "DEV": "1", "PORT": str(ep), "DATA_DIR": data, "SYMBOLS": "BTC,ETH", "PRICE_EVERY_S": "2",
       "MARKET_URL": f"http://127.0.0.1:{mp}", "ELEVENLABS_API_KEY": "test-key", "ELEVENLABS_URL": f"http://127.0.0.1:{vp}",
       "ELEVENLABS_VOICE": "voice123", "OFFLINE_FIXTURES": "/nonexistent", "WEB_DIR": "/nonexistent"}
for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY"): env.pop(k, None)
proc = subprocess.Popen([ENGINE], env=env, cwd=data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
U = f"http://127.0.0.1:{ep}"
try:
    for _ in range(60):
        try:
            if httpx.get(U + "/v1/health", timeout=1).status_code == 200: break
        except _httpx.HTTPError: time.sleep(0.5)
    reg = {m["symbol"]: m for m in httpx.get(U + "/v1/market/regimes").json()}
    check("both symbols load from the live feed", reg.keys() == {"BTC", "ETH"} and all(m["feed"] == "live" for m in reg.values()), reg)

    # ---- SSE ticks ----
    ticks = []
    def sse():
        try:
            with _httpx.Client(trust_env=False, timeout=None).stream("GET", U + "/v1/stream?token=dev:live") as r:
                ev = None
                for line in r.iter_lines():
                    if line.startswith("event:"): ev = line[6:].strip()
                    elif line.startswith("data:") and ev == "tick": ticks.append(json.loads(line[5:])["data"])
        except _httpx.HTTPError:
            pass  # engine stopped at the end of the test
    threading.Thread(target=sse, daemon=True).start()
    t0 = time.time()
    while time.time() - t0 < 15 and len([t for t in ticks if t["symbol"] == "BTC"]) < 3: time.sleep(0.2)
    btc = [t for t in ticks if t["symbol"] == "BTC"]
    check("SSE streams live ticks (>=3 BTC ticks within 15s at PRICE_EVERY_S=2)", len(btc) >= 3, len(btc))
    check("tick prices move", len({t["price"] for t in btc}) >= 2, [t["price"] for t in btc])
    check("tick carries today's candle and regime/brain", btc and btc[-1]["bar"]["t"] == TODAY and btc[-1]["regime"] and btc[-1]["brain"], btc[-1:] )
    check("ETH ticks too", any(t["symbol"] == "ETH" for t in ticks))
    last = btc[-1]["price"]
    cs = httpx.get(U + "/v1/market/BTC/candles?days=3").json()
    check("candles endpoint follows the live price", abs(cs[-1]["c"] - httpx.get(U + "/v1/market/regimes").json()[0]["price"]) < 1e-6 and cs[-1]["t"] == TODAY, cs[-1])
    check("ticks are not written to the why-log", all(e["kind"] != "tick" for e in httpx.get(U + "/v1/accounts/me/events", headers={"x-dev-user": "live"}).json()))
    check("market refreshed several times", polls["n"] >= 4, polls)

    # ---- voice ----
    check("config reports voice on", httpx.get(U + "/v1/config").json()["voice"] is True)
    long = "Today up 0.8 percent, two trades, one win. " * 20
    r = httpx.get(U + "/v1/voice", params={"token": "dev:live", "text": long})
    check("voice proxy returns audio/mpeg", r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content.startswith(b"ID3"), (r.status_code, r.headers.get("content-type")))
    t = tts[-1] if tts else {}
    check("engine sends the key server-side to the configured voice", t.get("key") == "test-key" and t.get("path") == "/v1/text-to-speech/voice123", t)
    check("text capped at 240 chars, model set", len(t.get("text", "")) == 240 and t.get("model_id"), {k: (len(v) if k == "text" else v) for k, v in t.items()})
    check("voice without a valid token -> 401", httpx.get(U + "/v1/voice", params={"token": "nope", "text": "hi"}).status_code == 401)
    check("browser never sees the ElevenLabs key", "test-key" not in httpx.get(U + "/v1/config").text)
finally:
    proc.terminate()
    out = proc.communicate(timeout=10)[0]
    if not all(results): print("---- engine log ----\n" + out)

print(f"\n{sum(results)}/{len(results)} passed"); sys.exit(0 if all(results) else 1)
