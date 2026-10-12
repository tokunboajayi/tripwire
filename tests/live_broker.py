"""Real-money broker mode (BROKER=live), against a real engine binary and a fake Alpaca API (no keys, no internet).

    python tests/live_broker.py engine/target/release/vantrel-engine

Checks: live mode refuses to start unless every safety setting is deliberate; owner-only controls; broker sync;
the daily dollar-loss halt; halt/resume; the global kill switch halting real money; flatten; and a ledger exit
reaching the broker as a close-position call with the live keys (never the paper keys)."""
import json, os, socket, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import httpx

httpx = httpx.Client(trust_env=False, timeout=30)
ENGINE = os.path.abspath(sys.argv[1])
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backtest", "fixtures")
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

# ---- fake Alpaca ----
broker = {"equity": 500.0, "cash": 450.0, "positions": [{"symbol": "BTCUSD", "qty": "0.0008", "market_value": "50.00"}], "calls": []}
class Alpaca(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, body):
        b = json.dumps(body).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)
    def record(self):
        n = int(self.headers.get("content-length") or 0)
        broker["calls"].append({"method": self.command, "path": self.path, "key": self.headers.get("APCA-API-KEY-ID"),
                                "body": json.loads(self.rfile.read(n)) if n else None})
    def do_GET(self):
        self.record()
        if self.path == "/v2/account": return self.reply(200, {"equity": str(broker["equity"]), "cash": str(broker["cash"])})
        if self.path == "/v2/positions": return self.reply(200, broker["positions"])
        if self.path.startswith("/v2/orders/"): return self.reply(200, {"id": self.path.rsplit("/", 1)[1], "status": "filled", "filled_avg_price": "61000.5"})
        self.reply(404, {"message": "not found"})
    def do_POST(self):
        self.record(); self.reply(200, {"id": "ord-1", "status": "accepted"})
    def do_DELETE(self):
        self.record()
        if self.path.startswith("/v2/positions"):
            broker["positions"] = [p for p in broker["positions"] if not self.path.startswith("/v2/positions/" + p["symbol"]) and "cancel_orders" not in self.path]
            return self.reply(200, {"id": "ord-2", "status": "filled", "filled_avg_price": "60900"} if "/v2/positions/" in self.path else [])
        self.reply(404, {})

ap = free_port()
threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", ap), Alpaca).serve_forever, daemon=True).start()

OWNER = "guest|AJ.0123456789abcdef"
OWNER_H = {"authorization": "Bearer guest:AJ.0123456789abcdef"}
OTHER_H = {"authorization": "Bearer guest:Eve.fedcba9876543210"}
BASE = {"PORT": "0", "INTERNAL_TOKEN": "x" * 32, "MARKET_URL": "http://127.0.0.1:9", "OFFLINE_FIXTURES": FIXTURES, "WEB_DIR": "/nonexistent",
        "SYMBOLS": "BTC", "DEV": "0", "MIRROR_USER": OWNER, "OWNER_USER": OWNER, "BROKER": "live", "LIVE_CONFIRM": "real-money",
        "BROKER_CAPITAL_USD": "500", "APCA_LIVE_KEY_ID": "live-key", "APCA_LIVE_SECRET_KEY": "live-secret",
        "APCA_API_KEY_ID": "paper-key", "APCA_API_SECRET_KEY": "paper-secret", "APCA_LIVE_URL": f"http://127.0.0.1:{ap}"}

def run_env(extra, data=None):
    env = {k: v for k, v in os.environ.items() if "PROXY" not in k.upper() and k not in ("AUTH0_DOMAIN", "GUEST_SIGNIN")}
    env.update({**BASE, "DATA_DIR": data or tempfile.mkdtemp(prefix="vt-brk-"), **extra})
    return {k: v for k, v in env.items() if v is not None}

def refuses(name, extra, needle):
    data = tempfile.mkdtemp(prefix="vt-brk-")
    p = subprocess.run([ENGINE], env=run_env(extra, data), cwd=data, capture_output=True, text=True, timeout=30)
    check(name, p.returncode != 0 and needle in p.stderr + p.stdout, (p.returncode, (p.stderr + p.stdout)[-300:]))

refuses("live refuses without LIVE_CONFIRM", {"LIVE_CONFIRM": None}, "LIVE_CONFIRM=real-money")
refuses("live refuses a wrong LIVE_CONFIRM", {"LIVE_CONFIRM": "yes"}, "LIVE_CONFIRM=real-money")
refuses("live refuses with DEV=1", {"DEV": "1"}, "DEV=1")
refuses("live refuses without BROKER_CAPITAL_USD", {"BROKER_CAPITAL_USD": None}, "BROKER_CAPITAL_USD")
refuses("live refuses without live keys (paper keys don't count)", {"APCA_LIVE_KEY_ID": None}, "APCA_LIVE_KEY_ID")
refuses("live refuses a per-order cap above the capital", {"LIVE_MAX_ORDER_USD": "900"}, "can't exceed")
refuses("broker refuses without MIRROR_USER", {"MIRROR_USER": None}, "MIRROR_USER")
refuses("a typo in BROKER is refused, not ignored", {"BROKER": "lvie"}, "BROKER must be")

# ---- the owner's account, seeded with an open BTC position so an exit can reach the broker ----
data = tempfile.mkdtemp(prefix="vt-brk-")
now = int(time.time())
lim = {"risk": 0.02, "maxpos": 0.75, "vol_target": 0.4, "exposure": 0.85, "daily_loss": 0.04, "max_orders_per_min": 6.0}
acct = {"user": OWNER, "profile": "balanced", "limits": lim, "start_cash": 10000.0, "goal_amount": 1000.0, "goal_months": 12.0, "created": now,
        "status": "active", "sleeves": {"BTC": {"cash": 9000.0, "last_exit": 0, "pos": {"qty": 0.016, "entry": 62000.0, "cost": 1000.0,
        "brain": "TREND", "regime": "TREND_UP", "stop": 1.0, "hi": 62000.0, "opened": now - 86400, "thesis": None}}},
        "trades": [], "equity": [[now, 10000.0]], "events": [], "order_times": [], "day": now // 86400, "day_start_equity": 10000.0,
        "mcp_token": "vt_mcp_test", "digest": None}
json.dump({OWNER: acct}, open(os.path.join(data, "state.json"), "w"))
port = free_port()
proc = subprocess.Popen([ENGINE], env=run_env({"PORT": str(port)}, data), cwd=data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
U = f"http://127.0.0.1:{port}"
try:
    for _ in range(60):
        try:
            if httpx.get(U + "/v1/health", timeout=1).status_code == 200: break
        except Exception: time.sleep(0.5)
    check("public config says broker=live", httpx.get(U + "/v1/config").json().get("broker") == "live")
    check("another user can't see broker controls", httpx.get(U + "/v1/live", headers=OTHER_H).status_code == 403)
    check("another user can't halt or flatten", httpx.post(U + "/v1/live/flatten", headers=OTHER_H).status_code == 403)
    s = httpx.post(U + "/v1/live/sync", headers=OWNER_H).json()
    check("owner sees live status synced from the broker", s["mode"] == "live" and s["equity"] == 500 and s["deployed"] == 50 and s["halted"] is None, s)
    check("caps default from the capital (10%/order, 3% daily loss)", s["guard"]["max_order"] == 50 and s["guard"]["max_daily_loss"] == 15, s["guard"])
    check("only the live key was used", broker["calls"] and all(c["key"] == "live-key" for c in broker["calls"]), {c["key"] for c in broker["calls"]})

    broker["equity"] = 480.0  # down $20 today, limit $15
    s = httpx.post(U + "/v1/live/sync", headers=OWNER_H).json()
    check("daily dollar loss halts new buys", s["halted"] == "LIVE_DAILY_LOSS" and s["day_pnl"] == -20, s)
    ev = httpx.get(U + "/v1/accounts/me/events", headers=OWNER_H).json()
    check("the halt is in the owner's why-log", any(e["kind"] == "mirror" and "LIVE_DAILY_LOSS" in json.dumps(e) for e in ev))
    broker["equity"] = 500.0
    s = httpx.post(U + "/v1/live/resume", headers=OWNER_H).json()
    check("owner can resume once back inside the limit", s["halted"] is None, s)
    check("halt is persisted", httpx.post(U + "/v1/live/halt", headers=OWNER_H).json()["halted"] == "OWNER_HALT"
          and json.load(open(os.path.join(data, "live.json")))["halted"] == "OWNER_HALT")
    httpx.post(U + "/v1/live/resume", headers=OWNER_H)

    check("global kill switch on", httpx.post(U + "/v1/admin/kill-all", headers=OWNER_H).json()["kill"] is True)
    check("kill switch halts real money too", httpx.get(U + "/v1/live", headers=OWNER_H).json()["halted"] == "KILL_SWITCH")
    check("can't resume real money while the kill switch is on", httpx.post(U + "/v1/live/resume", headers=OWNER_H).status_code == 409)
    httpx.post(U + "/v1/admin/kill-all", headers=OWNER_H)
    httpx.post(U + "/v1/live/resume", headers=OWNER_H)

    # a ledger exit (owner flattens the paper account) must reach the broker as a close-position call within one trading tick
    check("paper flatten accepted", httpx.post(U + "/v1/accounts/me/flatten", headers=OWNER_H).status_code == 200)
    deadline = time.time() + 75
    while time.time() < deadline and not any(c["method"] == "DELETE" and c["path"] == "/v2/positions/BTCUSD" for c in broker["calls"]):
        time.sleep(1)
    check("exit sent to the broker as DELETE /v2/positions/BTCUSD", any(c["method"] == "DELETE" and c["path"] == "/v2/positions/BTCUSD" for c in broker["calls"]))
    time.sleep(3)
    s = httpx.get(U + "/v1/live", headers=OWNER_H).json()
    check("the fill is recorded with slippage vs the model", s["fills"] and s["fills"][0]["side"] == "sell" and s["fills"][0]["slip_bps"] is not None, s["fills"])

    broker["positions"] = [{"symbol": "ETHUSD", "qty": "0.01", "market_value": "30"}]
    s = httpx.post(U + "/v1/live/flatten", headers=OWNER_H).json()
    check("flatten closes everything and halts", s["halted"] == "FLATTENED" and any("cancel_orders=true" in c["path"] for c in broker["calls"]), s)
    check("no order ever went out with the paper key", all(c["key"] != "paper-key" for c in broker["calls"]))
finally:
    proc.terminate(); out = proc.communicate(timeout=10)[0]
    if not all(results): print("---- engine log ----\n" + out[-3000:]); print("calls:", [(c["method"], c["path"]) for c in broker["calls"]])

print(f"\n{sum(results)}/{len(results)} passed"); sys.exit(0 if all(results) else 1)
