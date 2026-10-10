"""Key-free agents: rule-based reasoning, theses, news checks and digests.
Used automatically when ANTHROPIC_API_KEY is not set. Everything is labeled 'rule-based' so the demo stays honest."""

BAD_NEWS = ["hack", "exploit", "outage", "halt", "ban", "lawsuit", "sec charges", "delist", "insolven", "bankrupt", "breach", "fraud", "crash"]
LABEL = {"RANGE": "Calm", "TREND_UP": "Trending up", "HIGH_VOL": "High volatility", "TREND_DOWN": "Falling"}
BRAIN = {"RANGE": "Mean-Reversion", "TREND_UP": "Trend", "HIGH_VOL": "Breakout", "TREND_DOWN": "Shield"}

def reasoning(m: dict) -> str:
    i, p = m["indicators"], m["price"]
    above = "above" if p > i["sma200"] else "below"
    trend = "a strong trend" if i["adx"] > 25 else "no clear trend"
    rsi = i["rsi2"]; mood = "sharply oversold" if rsi < 10 else "overbought" if rsi > 90 else "neutral"
    reg = m["deterministic"]
    return (f"[rule-based] {m['symbol']} is {above} its 200-day average (${i['sma200']:,.0f}). ADX {i['adx']:.0f} means {trend}. "
            f"Volatility is in the {i['atrp_rank']*100:.0f}th percentile of the last 90 days. Short-term momentum is {mood} (RSI-2 {rsi:.0f}). "
            f"Verdict: {LABEL[reg]} → {BRAIN[reg]} brain.\n")

def thesis(brain: str, ind: dict) -> dict:
    if brain == "TREND":
        return {"reason": f"[rule-based] Uptrend: price above its 50- and 200-day averages with ADX {ind['adx']:.0f}.",
                "invalidation": ["Daily close below the 50-day average", "ADX falls below 20 (trend fading)", "Volatility spikes into the top 15%"],
                "confidence": round(min(1.0, max(0.5, ind["adx"] / 50)), 2)}
    if brain == "MR":
        return {"reason": f"[rule-based] Calm market and a sharp dip (RSI-2 {ind['rsi2']:.0f}) while still above the 200-day average; expecting a bounce.",
                "invalidation": ["Close below the 200-day average", "No bounce within 10 days", "Volatility spike"], "confidence": 0.6}
    return {"reason": "[rule-based] Volatility expansion with a volume-confirmed breakout above the 10-day high.",
            "invalidation": ["Falls back below the breakout level", "Volume dries up", "Close below the 50-day average"], "confidence": 0.6}

def verdict(headline: str) -> dict:
    hit = next((w for w in BAD_NEWS if w in headline.lower()), None)
    return {"verdict": "break" if hit else "hold", "confidence": 0.75 if hit else 0.9,
            "evidence": f"[rule-based] headline mentions '{hit}': {headline[:80]}" if hit else "no red-flag words"}

def digest(a: dict) -> str:
    pnl, eq = a["pnl_today"], a["equity"]; closed = a["trades_today"]; held = [p["symbol"] for p in a["positions"]]
    first = f"Today {'+' if pnl >= 0 else '-'}${abs(pnl):,.2f} ({pnl / max(eq - pnl, 1) * 100:+.2f}%), portfolio ${eq:,.2f}."
    second = (f"{len(closed)} trade(s) closed; " if closed else "No trades closed; ") + (f"holding {', '.join(held)}." if held else "held cash on purpose while no brain had a setup.")
    return f"[rule-based] {first} {second}"
