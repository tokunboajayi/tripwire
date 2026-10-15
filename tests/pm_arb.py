"""Prediction-market arbitrage (Kalshi + Polymarket), against a real engine binary and fake venues (no keys, no internet).

    python tests/pm_arb.py engine/target/release/vantrel-engine

Paper: a verified cross-venue pair and a Kalshi outcome group get filled, an unverified pair never trades, the exposure
cap holds, Kalshi settlement pays the winning venue, events land in the audit chain, halt and the kill switch stop it.
Live: refuses unsafe configs; Kalshi orders are fill-or-kill and RSA-PSS signed (verified here with openssl);
Polymarket legs are refused; a failed second leg halts everything and says what is held."""
import base64, json, os, socket, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import httpx

httpx = httpx.Client(trust_env=False, timeout=30)
ENGINE = os.path.abspath(sys.argv[1])
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backtest", "fixtures")
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p
def wait_for(f, secs=15):
    end = time.time() + secs
    while time.time() < end:
        try:
            v = f()
            if v: return v
        except Exception: pass
        time.sleep(0.3)
    return None

TMP = tempfile.mkdtemp(prefix="vt-pm-")
subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", f"{TMP}/k.pem"], check=True, capture_output=True)
subprocess.run(["openssl", "pkey", "-in", f"{TMP}/k.pem", "-pubout", "-out", f"{TMP}/pub.pem"], check=True, capture_output=True)

def verify_sig(ts, method, path, sig_b64):
    msg, sig = f"{TMP}/m{time.time_ns()}", f"{TMP}/s{time.time_ns()}"
    open(msg, "w").write(ts + method + path); open(sig, "wb").write(base64.b64decode(sig_b64))
    r = subprocess.run(["openssl", "dgst", "-sha256", "-sigopt", "rsa_padding_mode:pss", "-sigopt", "rsa_pss_saltlen:32", "-verify", f"{TMP}/pub.pem", "-signature", sig, msg], capture_output=True, text=True)
    return "Verified OK" in r.stdout

# ---- fake Kalshi: books are bids; YES ask = 100 - best NO bid ----
K = {"books": {"FED": {"yes": [[35, 500]], "no": [[60, 500]]},          # YES ask 0.40
               "RAIN": {"yes": [[30, 500]], "no": [[60, 500]]},
               "WHO-A": {"yes": [], "no": [[70, 200]]}, "WHO-B": {"yes": [], "no": [[75, 200]]}, "WHO-C": {"yes": [], "no": [[67, 200]]}},
     "status": {}, "orders": [], "reject": set(), "balance": 30000}
class Kalshi(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, b):
        b = json.dumps(b).encode(); self.send_response(code); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = urlparse(self.path).path.removeprefix("/trade-api/v2")
        if p.endswith("/orderbook"): return self.reply(200, {"orderbook": K["books"][p.split("/")[2]]})
        if p.startswith("/markets/"):
            t = p.split("/")[2]; st = K["status"].get(t)
            return self.reply(200, {"market": {"ticker": t, "status": "settled" if st else "active", "result": st or ""}})
        if p == "/portfolio/balance": return self.reply(200, {"balance": K["balance"]})
        self.reply(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        h = {k: self.headers.get(k) for k in ("KALSHI-ACCESS-KEY", "KALSHI-ACCESS-TIMESTAMP", "KALSHI-ACCESS-SIGNATURE")}
        ok = all(h.values()) and verify_sig(h["KALSHI-ACCESS-TIMESTAMP"], "POST", urlparse(self.path).path, h["KALSHI-ACCESS-SIGNATURE"])
        K["orders"].append({**body, "sig_ok": ok, "key": h["KALSHI-ACCESS-KEY"]})
        if body["ticker"] in K["reject"]: return self.reply(200, {"order": {"status": "canceled"}})
        self.reply(201, {"order": {"order_id": "o1", "status": "executed"}})

# ---- fake Polymarket CLOB ----
P = {"PY-FED": 0.50, "PN-FED": 0.52, "PY-RAIN": 0.5, "PN-RAIN": 0.45}
class Poly(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        t = parse_qs(urlparse(self.path).query)["token_id"][0]
        b = json.dumps({"asks": [{"price": str(P[t]), "size": "300"}], "bids": []}).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)

kp, pp = free_port(), free_port()
for port, h in ((kp, Kalshi), (pp, Poly)): threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", port), h).serve_forever, daemon=True).start()

PAIRS = {"pairs": [{"id": "fed", "label": "Fed cuts in December", "kalshi": "FED", "poly_yes": "PY-FED", "poly_no": "PN-FED", "verified": True},
                   {"id": "rain", "label": "Rain in NYC", "kalshi": "RAIN", "poly_yes": "PY-RAIN", "poly_no": "PN-RAIN", "verified": False}],
         "groups": [{"id": "who", "label": "Who wins", "venue": "kalshi", "markets": ["WHO-A", "WHO-B", "WHO-C"], "exhaustive": True, "verified": True}]}

def start(extra, data=None):
    data = data or tempfile.mkdtemp(prefix="vt-pmd-"); json.dump(PAIRS, open(f"{data}/pairs.json", "w"))
    port = free_port()
    env = {k: v for k, v in os.environ.items() if "PROXY" not in k.upper() and k not in ("AUTH0_DOMAIN",)}
    env.update({"PORT": str(port), "DATA_DIR": data, "MARKET_URL": "http://127.0.0.1:9", "OFFLINE_FIXTURES": FIXTURES, "WEB_DIR": "/nonexistent",
                "SYMBOLS": "BTC", "INTERNAL_TOKEN": "x" * 32, "KALSHI_URL": f"http://127.0.0.1:{kp}/trade-api/v2", "POLY_CLOB_URL": f"http://127.0.0.1:{pp}",
                "PM_EVERY_MS": "400", "PM_MIN_EDGE_BPS": "100", "PM_MAX_ARB_USD": "50", "PM_SETTLE_S": "1", **extra})
    env = {k: v for k, v in env.items() if v is not None}
    proc = subprocess.Popen([ENGINE], env=env, cwd=data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return proc, f"http://127.0.0.1:{port}", data

def refuses(name, extra, needle):
    data = tempfile.mkdtemp(prefix="vt-pmr-")
    env = {k: v for k, v in os.environ.items() if "PROXY" not in k.upper()}
    env.update({"PORT": str(free_port()), "DATA_DIR": data, "MARKET_URL": "http://127.0.0.1:9", "OFFLINE_FIXTURES": FIXTURES, "INTERNAL_TOKEN": "x" * 32, "DEV": "0", **extra})
    env = {k: v for k, v in env.items() if v is not None}
    p = subprocess.run([ENGINE], env=env, cwd=data, capture_output=True, text=True, timeout=30)
    check(name, p.returncode != 0 and needle in p.stdout + p.stderr, (p.returncode, (p.stdout + p.stderr)[-200:]))

refuses("live refuses without PM_LIVE_CONFIRM", {"PM_MODE": "live", "KALSHI_KEY_ID": "k", "KALSHI_PRIVATE_KEY_PATH": f"{TMP}/k.pem"}, "PM_LIVE_CONFIRM=real-money")
refuses("live refuses without Kalshi keys", {"PM_MODE": "live", "PM_LIVE_CONFIRM": "real-money", "OWNER_USER": "auth0|x"}, "KALSHI_KEY_ID")
refuses("live refuses without OWNER_USER (nobody could halt it)", {"PM_MODE": "live", "PM_LIVE_CONFIRM": "real-money", "KALSHI_KEY_ID": "k", "KALSHI_PRIVATE_KEY_PATH": f"{TMP}/k.pem"}, "OWNER_USER")
refuses("live refuses DEV=1", {"PM_MODE": "live", "PM_LIVE_CONFIRM": "real-money", "DEV": "1", "KALSHI_KEY_ID": "k", "KALSHI_PRIVATE_KEY_PATH": f"{TMP}/k.pem"}, "DEV=1")
refuses("a PM_MODE typo is refused", {"PM_MODE": "papr"}, "PM_MODE must be")

# ---------------- paper ----------------
OWN = {"x-dev-user": "AJ"}
proc, U, data = start({"PM_MODE": "paper", "DEV": "1", "OWNER_USER": "dev|AJ", "PM_COOLDOWN_S": "1", "PM_MAX_EXPOSURE_USD": "120"})
try:
    wait_for(lambda: httpx.get(U + "/v1/health").status_code == 200)
    httpx.post(U + "/v1/accounts", headers=OWN, json={"profile": "balanced"})
    check("config reports pm=paper", httpx.get(U + "/v1/config").json().get("pm") == "paper")
    check("another user can't see the arb engine", httpx.get(U + "/v1/pm", headers={"x-dev-user": "Eve"}).status_code == 403)
    s = wait_for(lambda: (lambda s: s if {p["arb"]["id"] for p in s["state"]["positions"]} >= {"fed", "who"} else None)(httpx.get(U + "/v1/pm", headers=OWN).json()))
    check("verified cross pair and outcome group both filled", s is not None, s and [p["arb"]["id"] for p in s["state"]["positions"]])
    s = httpx.get(U + "/v1/pm", headers=OWN).json(); st = s["state"]
    fed = next(p["arb"] for p in st["positions"] if p["arb"]["id"] == "fed")
    check("cross set = YES on Kalshi @40c + NO on Polymarket @52c", [(l["venue"], l["side"], l["price"]) for l in fed["legs"]] == [["kalshi", "yes", 0.4], ["polymarket", "no", 0.52]] or
          [(l["venue"], l["side"], l["price"]) for l in fed["legs"]] == [("kalshi", "yes", 0.4), ("polymarket", "no", 0.52)], fed["legs"])
    check("set is sized by the $50 cap and profitable after fees", fed["contracts"] == 54 and fed["profit"] > 2, fed)
    check("unverified pair is seen but never traded", any(o["arb"]["id"] == "rain" and o["status"] == "PAIR_UNVERIFIED" for o in st["opps"])
          and not any(p["arb"]["id"] == "rain" for p in st["positions"]))
    time.sleep(2)
    st = httpx.get(U + "/v1/pm", headers=OWN).json()["state"]
    check("exposure cap holds ($120)", sum(p["arb"]["cost"] + p["arb"]["fees"] for p in st["positions"]) <= 120 and any(o["status"] == "PM_EXPOSURE_CAP" for o in st["opps"]),
          [o["status"] for o in st["opps"]][:6])
    check("paper cash moved out of both venues", st["balances"]["kalshi"] < 500 and st["balances"]["polymarket"] < 500, st["balances"])
    n_open, locked = len(st["positions"]), st["locked"]

    K["status"]["FED"] = "no"  # Kalshi leg was YES, so the Polymarket NO leg wins
    st = wait_for(lambda: (lambda st: st if st["settled"] else None)(httpx.get(U + "/v1/pm", headers=OWN).json()["state"]))
    check("Kalshi settlement closes the set and pays the winning venue", st and st["settled"][0]["payout_venue"] == "polymarket" and len(st["positions"]) < n_open, st and st["settled"])
    check("locked profit becomes realised", st and st["locked"] < locked and sum(st["realized"].values()) > 0, st and (st["locked"], st["realized"]))
    K["status"]["WHO-B"] = "yes"
    check("outcome group settles when one outcome resolves YES", wait_for(lambda: any(x["label"] == "Who wins" for x in httpx.get(U + "/v1/pm", headers=OWN).json()["state"]["settled"])))

    ev = httpx.get(U + "/v1/accounts/me/events", headers=OWN).json()
    check("fills and settlements are in the owner's why-log", any(e["kind"] == "pm" and "Arb (paper)" in e["msg"] for e in ev) and any(e["kind"] == "pm" and "Settled" in e["msg"] for e in ev))
    check("arb events are in the audit chain", any(e["kind"] == "pm" for e in httpx.get(U + "/v1/audit").json().get("entries", [])))
    plan = httpx.get(U + "/v1/pm", headers=OWN).json()["allocation"]
    check("allocator returns weights for every venue", {w[0] for w in plan["weights"]} >= {"kalshi", "polymarket"} and abs(sum(w[1] for w in plan["weights"]) - 1) < 0.01, plan)

    open_ids = sorted(p["id"] for p in httpx.get(U + "/v1/pm", headers=OWN).json()["state"]["positions"])
    httpx.post(U + "/v1/pm/halt", headers=OWN)
    proc.terminate(); proc.communicate(timeout=10)
    proc, U, _ = start({"PM_MODE": "paper", "DEV": "1", "OWNER_USER": "dev|AJ", "PM_COOLDOWN_S": "1", "PM_MAX_EXPOSURE_USD": "120"}, data)
    wait_for(lambda: httpx.get(U + "/v1/health").status_code == 200)
    st = httpx.get(U + "/v1/pm", headers=OWN).json()["state"]
    check("restart keeps open sets, halt and settled history", sorted(p["id"] for p in st["positions"]) == open_ids and st["halted"] == "OWNER_HALT" and st["settled"], (open_ids, st["halted"]))
    httpx.post(U + "/v1/pm/resume", headers=OWN)
    httpx.post(U + "/v1/pm/halt", headers=OWN)
    n = len(httpx.get(U + "/v1/pm", headers=OWN).json()["state"]["positions"]); time.sleep(2)
    check("halt stops new sets", len(httpx.get(U + "/v1/pm", headers=OWN).json()["state"]["positions"]) == n)
    httpx.post(U + "/v1/pm/resume", headers=OWN)
    httpx.post(U + "/v1/admin/kill-all", headers=OWN)
    check("global kill switch halts arbitrage", httpx.get(U + "/v1/pm", headers=OWN).json()["state"]["halted"] == "KILL_SWITCH")
    check("can't resume while the kill switch is on", httpx.post(U + "/v1/pm/resume", headers=OWN).status_code == 409)
finally:
    proc.terminate(); out = proc.communicate(timeout=10)[0]
    if not all(results): print("---- engine log ----\n" + out[-2000:])

# ---------------- live (Kalshi legs only) ----------------
GUEST = {"authorization": "Bearer guest:AJ.0123456789abcdef"}
K["status"].clear(); K["orders"].clear()  # fresh venue: nothing settled yet
proc, U, data = start({"PM_MODE": "live", "PM_LIVE_CONFIRM": "real-money", "DEV": "0", "OWNER_USER": "guest|AJ.0123456789abcdef",
                       "KALSHI_KEY_ID": "key-123", "KALSHI_PRIVATE_KEY_PATH": f"{TMP}/k.pem", "PM_COOLDOWN_S": "1", "PM_MAX_EXPOSURE_USD": "1000"})
try:
    wait_for(lambda: httpx.get(U + "/v1/health").status_code == 200)
    s = wait_for(lambda: (lambda s: s if any(p["arb"]["id"] == "who" for p in s["state"]["positions"]) else None)(httpx.get(U + "/v1/pm", headers=GUEST).json()))
    check("live: Kalshi outcome group executed", s is not None)
    check("live: real Kalshi balance loaded", s and s["state"]["balances"].get("kalshi", 0) > 0, s and s["state"]["balances"])
    who = [o for o in K["orders"] if o["ticker"].startswith("WHO")]
    check("live: every order is fill-or-kill at the quoted price", who and all(o["time_in_force"] == "fill_or_kill" and o["action"] == "buy" and o["side"] == "yes" for o in who)
          and {o["ticker"]: o["yes_price"] for o in who[:3]} == {"WHO-A": 30, "WHO-B": 25, "WHO-C": 33}, who[:3])
    check("live: every order carries a valid RSA-PSS signature", who and all(o["sig_ok"] and o["key"] == "key-123" for o in who))
    check("live: Polymarket legs are refused, never sent", any(o["arb"]["id"] == "fed" and o["status"] == "POLY_LIVE_UNSUPPORTED" for o in s["state"]["opps"])
          and not any(o["ticker"] == "FED" for o in K["orders"]))
    K["reject"].add("WHO-B")
    st = wait_for(lambda: (lambda st: st if st["halted"] else None)(httpx.get(U + "/v1/pm", headers=GUEST).json()["state"]))
    check("live: a failed leg after a filled leg halts everything", st and st["halted"] == "LEG_FAILED", st and st["halted"])
    ev = httpx.get(U + "/v1/audit").json().get("entries", [])
    check("live: the halt says what is held", any(e["kind"] == "pm" and "unhedged" in e["msg"] and "WHO-A" in e["msg"] for e in ev))
finally:
    proc.terminate(); out = proc.communicate(timeout=10)[0]
    if not all(results): print("---- engine log ----\n" + out[-2000:])

print(f"\n{sum(results)}/{len(results)} passed"); sys.exit(0 if all(results) else 1)
