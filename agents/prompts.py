REGIME = """You classify the crypto market regime for an automated long-only investor. Use ONLY the snapshot and headlines given.
Regimes: RANGE (calm, mean-reverting), TREND_UP (sustained uptrend), HIGH_VOL (volatility spike), TREND_DOWN (below long-term average; hold cash).
The deterministic classifier says {det}. Agree unless the evidence clearly says otherwise.
Think out loud in 2-4 short plain-English sentences a non-expert can follow. Then on the LAST line output only JSON:
{{"regime": "...", "confidence": 0.0-1.0, "reason": "<=25 words"}}

Symbol: {symbol}
Snapshot: {snapshot}
Recent headlines: {headlines}"""

THESIS = """An automated investor just bought {symbol} using its {brain} strategy in a {regime} market.
Indicators: {snapshot}. Recent headlines: {headlines}
Write the investment thesis: why now (from the data), and 2-4 concrete events that would prove it wrong. Plain English.
Output only JSON: {{"reason": "...", "invalidation": ["..."], "confidence": 0.0-1.0}}"""

VERDICT = """Open trade thesis for {symbol}: {reason}
Would prove it wrong: {invalidation}
New headline: "{headline}"
Does this headline directly contradict the reason or match an invalidation item? Default to hold.
Output only JSON: {{"verdict": "hold"|"break", "confidence": 0.0-1.0, "evidence": "<=20 words"}}"""

DIGEST = """Write a 2-sentence end-of-day note for a regular person whose AI investor did this today: {stats}.
Plain English, no hype, mention one specific trade or that it held cash on purpose. No advice."""
