"""End-to-end test of a running Vantrel engine: API, risk gate, agent routes, SSE, replay, agents, MCP servers.

Start a fresh engine first (offline fixtures keep results deterministic):
    cd engine && DEV=1 DATA_DIR=/tmp/vt MARKET_URL=http://127.0.0.1:9 PORT=8099 ./target/release/vantrel-engine
Then:  python tests/e2e.py .        (needs: httpx pydantic mcp, and tv-mcp installed: pip install -e tv-mcp)
Env: U (engine URL, default http://127.0.0.1:8099), INTERNAL_TOKEN (default change-me, DEV only)."""
import sys, os, json, time, threading, asyncio, tempfile, httpx
REPO = sys.argv[1]; U = os.environ.get("U", "http://127.0.0.1:8099")
I = {"x-internal-token": os.environ.get("INTERNAL_TOKEN", "change-me")}
D = {"x-dev-user": "e2e"}
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))
c = httpx.Client(base_url=U, timeout=30)

# --- public ---
check("health", c.get("/v1/health").json() == {"ok": True})
cfg = c.get("/v1/config").json(); check("config lists symbols", "BTC" in cfg["symbols"], cfg)
reg = c.get("/v1/market/regimes").json(); check("regimes: BTC loaded with brain", reg and reg[0]["symbol"] == "BTC" and reg[0]["brain"] in ("MR", "TREND", "BREAKOUT", "SHIELD"), reg)
cs = c.get("/v1/market/BTC/candles?days=50").json(); check("candles: 50 bars with regime tags", len(cs) == 50 and all(k["regime"] for k in cs), len(cs))
check("candles: unknown symbol 404", c.get("/v1/market/XYZ/candles").status_code == 404)
bt = c.get("/v1/backtest").json(); check("backtest headline present", bt["headline"]["trades"] == 98, bt.get("headline"))
check("SPA fallback serves app on /onboard", "<div id=\"root\">" in c.get("/onboard").text)

# --- auth ---
check("me without auth -> 401", c.get("/v1/accounts/me").status_code == 401)
check("me before onboarding -> 404", c.get("/v1/accounts/me", headers=D).status_code == 404)
check("bad profile rejected", c.post("/v1/accounts", headers=D, json={"profile": "yolo"}).status_code == 400)

# --- live stream (SSE) in background ---
events = []
def sse():
    try:
        with httpx.stream("GET", U + "/v1/stream?token=dev:e2e", timeout=None) as r:
            for line in r.iter_lines():
                if line.startswith("event:"): events.append(line[6:].strip())
    except Exception as e: events.append("ERR " + str(e))
threading.Thread(target=sse, daemon=True).start(); time.sleep(0.5)

# --- onboarding ---
a = c.post("/v1/accounts", headers=D, json={"profile": "balanced", "start_cash": 10000, "goal_amount": 5000, "goal_months": 12}).json()
check("onboard: account funded", a["equity"] == 10000 and a["profile"] == "balanced" and a["goal"]["amount"] == 5000, a)
check("onboard: limits match balanced profile", a["limits"]["risk"] == 0.02 and a["limits"]["maxpos"] == 0.75 and a["limits"]["daily_loss"] == 0.04)
tok = a["mcp_token"]; check("mcp token issued with vt_ prefix", tok.startswith("vt_mcp_"), tok)

# --- risk slider ---
r = c.patch("/v1/accounts/me/profile", headers=D, json={"profile": "conservative"}).json()
check("slider -> conservative tightens limits", r["limits"]["risk"] == 0.01 and r["limits"]["exposure"] == 0.6, r)
r = c.patch("/v1/accounts/me/profile", headers=D, json={"profile": "aggressive"}).json()
check("slider -> aggressive (user may loosen)", r["limits"]["risk"] == 0.03, r)
c.patch("/v1/accounts/me/profile", headers=D, json={"profile": "balanced"})

# --- data endpoints ---
check("positions endpoint", c.get("/v1/accounts/me/positions", headers=D).json() == [])
check("trades endpoint", c.get("/v1/accounts/me/trades", headers=D).json() == [])
eq = c.get("/v1/accounts/me/equity?range=1d", headers=D).json(); check("equity?range=1d returns points", len(eq) >= 1 and eq[-1][1] == 10000, eq)
check("events?limit=2 honoured", len(c.get("/v1/accounts/me/events?limit=2", headers=D).json()) <= 2)

# --- AI can't loosen limits ---
c.post("/v1/accounts/me/agent-loosen", headers=D)
ev = c.get("/v1/accounts/me/events?limit=5", headers=D).json()
blk = [e for e in ev if e["data"].get("code") == "LIMIT_LOOSEN_DENIED"]
check("agent-loosen -> LIMIT_LOOSEN_DENIED with latency", blk and blk[0]["data"]["latency_ns"] > 0, ev[:2])

# --- controls ---
for act, status in [("pause", "paused"), ("resume", "active"), ("kill", "killed"), ("resume", "active")]:
    c.post(f"/v1/accounts/me/{act}", headers=D)
    check(f"control {act} -> {status}", c.get("/v1/accounts/me", headers=D).json()["status"] == status)
check("flatten with no positions ok", c.post("/v1/accounts/me/flatten", headers=D).status_code == 200)
check("unknown action 404", c.post("/v1/accounts/me/explode", headers=D).status_code == 404)

# --- MCP token is read-only ---
M = {"x-mcp-token": tok}
check("mcp token can read", c.get("/v1/accounts/me", headers=M).status_code == 200)
check("mcp token cannot write", c.post("/v1/accounts/me/pause", headers=M).status_code == 403)
check("mcp read hides token", c.get("/v1/accounts/me", headers=M).json()["mcp_token"] is None)

# --- internal (agent) routes ---
check("internal without token -> 401", c.get("/internal/snapshot").status_code == 401)
check("internal with token", c.get("/internal/snapshot", headers=I).status_code == 200)
det = reg[0]["deterministic"]
ok = c.post("/internal/regime", headers=I, json={"symbol": "BTC", "regime": det, "confidence": 0.8, "reason": "agrees"}).json()
check("AI regime agreeing with data accepted", ok["source"] == "ai", ok)
bad = c.post("/internal/regime", headers=I, json={"symbol": "BTC", "regime": "HIGH_VOL", "confidence": 0.6, "reason": "jumpy"}).json()
check("AI regime contradicting data -> REGIME_MISMATCH override", bad["source"] == "override_rejected" and bad["final"] == det, bad)
lim = a["limits"]
check("agent may tighten limits", c.post("/internal/limits", headers=I, json={"account": "dev|e2e", "limits": {**lim, "risk": 0.01}}).status_code == 200)
r = c.post("/internal/limits", headers=I, json={"account": "dev|e2e", "limits": {**lim, "risk": 0.05}})
check("agent may not go above the user's ceiling -> 403 LIMIT_LOOSEN_DENIED", r.status_code == 403 and "LIMIT_LOOSEN_DENIED" in r.text, r.text)
r = c.post("/internal/limits", headers=I, json={"account": "dev|e2e", "limits": {**lim, "risk": 0.0125}})
check("agent raising risk with no winning record -> 403 RISK_NOT_EARNED", r.status_code == 403 and "RISK_NOT_EARNED" in r.text, r.text)
r = c.post("/internal/limits", headers=I, json={"account": "dev|e2e", "limits": {**lim, "risk": 0.02}})
check("agent jumping +100% in one step -> 403 RISK_STEP_TOO_BIG", r.status_code == 403 and "RISK_STEP_TOO_BIG" in r.text, r.text)
c.patch("/v1/accounts/me/profile", headers=D, json={"profile": c.get("/v1/accounts/me", headers=D).json()["profile"]})  # user resets via the slider
check("thesis for missing position -> 404", c.post("/internal/thesis", headers=I, json={"account": "dev|e2e", "symbol": "BTC", "reason": "x", "invalidation": [], "confidence": 0.5}).status_code == 404)
check("digest stored", c.post("/internal/digest", headers=I, json={"account": "dev|e2e", "text": "Held cash today."}).status_code == 200 and c.get("/v1/accounts/me", headers=D).json()["digest"] == "Held cash today.")
c.post("/internal/stream", headers=I, json={"symbol": "BTC", "text": "thinking..."})

# --- security limits ---
big = httpx.post(U + "/v1/accounts", headers={**D, "content-type": "application/json"}, content=json.dumps({"profile": "a" * 20000}))
check("body > 16KB rejected (413)", big.status_code == 413, big.status_code)
check("CORS: foreign origin not allowed", "access-control-allow-origin" not in httpx.get(U + "/v1/health", headers={"origin": "https://evil.example"}).headers)

# --- audit chain ---
st = c.get("/v1/audit/status").json(); check("audit chain intact and growing", st["chain_ok"] and st["entries"] > 3, st)

# --- replay ---
check("replay starts", c.post("/v1/replays", headers=D, json={"speed": 200, "dataset": "crypto", "from": "2025-06-01"}).json()["status"] == "running")
check("second replay while running -> 409", c.post("/v1/replays", headers=D, json={"speed": 200}).status_code == 409)
for _ in range(60):
    rp = c.get("/v1/replays/me", headers=D).json()
    if rp["status"] == "done": break
    time.sleep(1)
check("replay finishes with equity curve and buy&hold", rp["status"] == "done" and len(rp["equity"]) > 100 and len(rp["buy_hold"]) == len(rp["equity"]), {k: len(v) if isinstance(v, list) else v for k, v in rp.items()})
check("replay produced trades", len(rp["trades"]) > 0, len(rp["trades"]))
check("stocks replay without data -> 404", c.post("/v1/replays", headers=D, json={"dataset": "stocks"}).status_code == 404)

# --- SSE delivered events ---
time.sleep(1)
for k in ["account", "limits", "gate_block", "status", "ai_regime", "reasoning", "digest", "replay_tick", "replay_done"]:
    check(f"SSE delivered '{k}'", k in events, sorted(set(events)))

# --- agents (rule-based mode, no API key) ---
sys.path.insert(0, f"{REPO}/agents"); os.environ["VANTREL_API"] = U; os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["AGENT_CACHE"] = tempfile.mkdtemp(prefix="vt-agent-cache-")
import worker
check("agents run without an API key (rule-based)", worker.llm is None)
try: worker.regime_round_rules(); worker.thesis_round_rules(set()); worker.digest_round_rules(); ok = True
except Exception as e: ok = False; print(e)
check("agent rounds (regime/thesis/digest) complete against engine", ok)
check("rule-based digest written", bool(c.get("/v1/accounts/me", headers=D).json()["digest"]))

# --- MCP servers over the real MCP protocol (stdio) ---
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
async def mcp_check(cmd, args, env, call=None):
    async with stdio_client(StdioServerParameters(command=cmd, args=args, env={**os.environ, **env})) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize(); tools = [t.name for t in (await s.list_tools()).tools]
            out = (await s.call_tool(call, {})) if call else None
            return tools, out
tools, out = asyncio.run(mcp_check(sys.executable, [f"{REPO}/mcp/server.py"], {"VANTREL_API": U, "VANTREL_MCP_TOKEN": tok}, "get_portfolio"))
check("MCP server exposes read-only tools", set(tools) >= {"get_portfolio", "get_positions", "get_recent_trades", "get_market_regimes", "get_daily_digest"} and not any("order" in t or "buy" in t for t in tools), tools)
txt = out.content[0].text if out and out.content else ""
check("MCP get_portfolio returns account, hides token", '"profile"' in txt and tok not in txt, txt[:200])
tools, out = asyncio.run(mcp_check(sys.executable, [f"{REPO}/mcp/server.py"], {"VANTREL_API": U, "VANTREL_MCP_TOKEN": "", "TRIPWIRE_MCP_TOKEN": tok}, "get_daily_digest"))
check("MCP accepts pre-rebrand TRIPWIRE_MCP_TOKEN", out and not out.isError, out)
tools, _ = asyncio.run(mcp_check(sys.executable, ["-m", "vantrel_tv_mcp.server"], {"VANTREL_API": U}))
check("tv-mcp server starts and lists tools", len(tools) >= 5, tools)

n = len(results); f = [r for r in results if not r[1]]
print(f"\n{n - len(f)}/{n} passed"); sys.exit(1 if f else 0)
