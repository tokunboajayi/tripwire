"""Sign-in on a public box, against a real engine binary configured like production: no DEV, a real INTERNAL_TOKEN, no Auth0.

Guards the live-site bug where typing a name and pressing Get started ended in "session expired": the page sent a
name-only dev identity, which a production engine (correctly) refuses. Guest ids carry a random key instead.

    python tests/public_signin.py engine/target/release/vantrel-engine
"""
import os, socket, subprocess, sys, tempfile, time
import httpx
httpx = httpx.Client(trust_env=False, timeout=30)

ENGINE = os.path.abspath(sys.argv[1])
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backtest", "fixtures")
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

def start(extra):
    port, data = free_port(), tempfile.mkdtemp(prefix="vt-pub-")
    env = {k: v for k, v in os.environ.items() if k not in ("DEV", "AUTH0_DOMAIN", "GUEST_SIGNIN") and "PROXY" not in k.upper()}
    env.update({"PORT": str(port), "DATA_DIR": data, "INTERNAL_TOKEN": "x" * 32, "MARKET_URL": "http://127.0.0.1:9",
                "OFFLINE_FIXTURES": FIXTURES, "WEB_DIR": "/nonexistent", "DEV": "0", **extra})
    proc = subprocess.Popen([ENGINE], env=env, cwd=data, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    u = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            if httpx.get(u + "/v1/health", timeout=1).status_code == 200: break
        except Exception: time.sleep(0.5)
    return proc, u

GUEST = "AJ.0123456789abcdef"
proc, U = start({})
try:
    cfg = httpx.get(U + "/v1/config").json()
    check("public engine: name sign-in on (guest), dev off", cfg.get("signin") == "name" and cfg.get("guest") is True and cfg.get("dev") is False, cfg)
    check("dev header refused (anyone could be anyone)", httpx.get(U + "/v1/accounts/me", headers={"x-dev-user": "AJ"}).status_code == 401)
    check("dev token refused", httpx.get(U + "/v1/accounts/me", headers={"authorization": "Bearer dev:AJ"}).status_code == 401)
    check("bare name refused", httpx.get(U + "/v1/accounts/me", headers={"authorization": "Bearer guest:AJ"}).status_code == 401)
    h = {"authorization": f"Bearer guest:{GUEST}"}
    check("new guest -> 404 (go to onboarding), not 401", httpx.get(U + "/v1/accounts/me", headers=h).status_code == 404)
    r = httpx.post(U + "/v1/accounts", headers=h, json={"profile": "balanced", "start_cash": 10000, "goal_amount": 5000, "goal_months": 12})
    check("guest can fund an account", r.status_code in (200, 201), (r.status_code, r.text[:200]))
    me = httpx.get(U + "/v1/accounts/me", headers=h)
    check("guest sees their portfolio", me.status_code == 200 and me.json().get("equity") == 10000, (me.status_code, me.text[:200]))
    other = {"authorization": "Bearer guest:AJ.fedcba9876543210"}
    check("same name, different key = different person", httpx.get(U + "/v1/accounts/me", headers=other).status_code == 404)
    check("SSE accepts the guest token", httpx.get(U + "/v1/voice", params={"token": f"guest:{GUEST}", "text": "hi"}).status_code == 404)  # 404 = voice off, i.e. auth passed
finally:
    proc.terminate(); out = proc.communicate(timeout=10)[0]
    if not all(results): print("---- engine log ----\n" + out[-3000:])

proc, U = start({"AUTH0_DOMAIN": "example.us.auth0.com"})
try:
    cfg = httpx.get(U + "/v1/config").json()
    check("Auth0 on the engine only: guest sign-in still works (no web/engine mismatch trap)", cfg.get("guest") is True and
          httpx.get(U + "/v1/accounts/me", headers={"authorization": f"Bearer guest:{GUEST}"}).status_code == 404, cfg)
finally:
    proc.terminate(); proc.communicate(timeout=10)

proc, U = start({"GUEST_SIGNIN": "0"})
try:
    check("GUEST_SIGNIN=0 and no Auth0 -> config says sign-in is off", httpx.get(U + "/v1/config").json().get("signin") == "none")
    check("GUEST_SIGNIN=0 refuses guest ids", httpx.get(U + "/v1/accounts/me", headers={"authorization": f"Bearer guest:{GUEST}"}).status_code == 401)
finally:
    proc.terminate(); proc.communicate(timeout=10)

print(f"\n{sum(results)}/{len(results)} passed"); sys.exit(0 if all(results) else 1)
