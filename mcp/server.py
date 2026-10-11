"""Vantrel MCP server: 'talk to your portfolio' from Claude. Read-only by design (no order tools).
Env: VANTREL_API (default http://127.0.0.1:8080), VANTREL_MCP_TOKEN (from the dashboard Settings)."""
import envload  # noqa: F401  (loads ../.env)
import os, httpx
from mcp.server.fastmcp import FastMCP

API = os.getenv("VANTREL_API", "http://127.0.0.1:8080")
mcp = FastMCP("vantrel")
def get(path: str):
    r = httpx.get(API + path, headers={"x-mcp-token": os.getenv("VANTREL_MCP_TOKEN", "")}, timeout=15); r.raise_for_status(); return r.json()

@mcp.tool()
def get_portfolio() -> dict:
    """Equity, today's and total P&L, goal progress, risk profile, limits, win rate vs break-even win rate."""
    a = get("/v1/accounts/me"); a.pop("mcp_token", None); return a

@mcp.tool()
def get_positions() -> list:
    """Open positions with the brain that opened them, stop price and the AI's written thesis."""
    return get("/v1/accounts/me")["positions"]

@mcp.tool()
def get_recent_trades(n: int = 10) -> list:
    """Most recent closed trades: brain, market regime, entry/exit, P&L and why it exited."""
    return (get("/v1/accounts/me/trades") or [])[-n:][::-1]

@mcp.tool()
def explain_recent_activity(n: int = 15) -> list:
    """The plain-English why-log: every buy, sell, brain switch and blocked order, newest first."""
    return [{"time": e["ts"], "kind": e["kind"], "what": e["msg"]} for e in get("/v1/accounts/me/events")[:n] if e["msg"]]

@mcp.tool()
def get_market_regimes() -> list:
    """Current regime and active brain per coin, and whether the AI's call was accepted or overridden by Rust."""
    return get("/v1/market/regimes")

@mcp.tool()
def get_daily_digest() -> str:
    """The AI's end-of-day summary for this account."""
    return get("/v1/accounts/me").get("digest") or "No digest yet today."

if __name__ == "__main__": mcp.run()
