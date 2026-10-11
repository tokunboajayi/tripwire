//! Regime classification (spec §4 steps 3–4). AI chooses, Rust verifies.
use crate::indicators::Row;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Regime { Range, TrendUp, HighVol, TrendDown }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Brain { Mr, Trend, Breakout, Shield }

impl Regime {
    /// The router: one brain per regime.
    pub fn brain(self) -> Brain {
        match self { Regime::Range => Brain::Mr, Regime::TrendUp => Brain::Trend, Regime::HighVol => Brain::Breakout, Regime::TrendDown => Brain::Shield }
    }
    pub fn label(self) -> &'static str {
        match self { Regime::Range => "Calm", Regime::TrendUp => "Trending up", Regime::HighVol => "High volatility", Regime::TrendDown => "Falling" }
    }
}

impl Brain {
    pub fn label(self) -> &'static str {
        match self { Brain::Mr => "Mean-Reversion", Brain::Trend => "Trend", Brain::Breakout => "Breakout", Brain::Shield => "Shield" }
    }
}

/// Deterministic regime: `ATR%rank>0.85 → HIGH_VOL; ADX>25 && c>EMA200 && EMA50>EMA200 → TREND_UP; c<SMA200 → TREND_DOWN; else RANGE`.
pub fn regime(c: f64, r: &Row) -> Regime {
    if r.atrp_rank > 0.85 { Regime::HighVol }
    else if r.adx > 25. && c > r.ema200 && r.ema50 > r.ema200 { Regime::TrendUp }
    else if c < r.sma200 { Regime::TrendDown }
    else { Regime::Range }
}

/// Accept the AI regime unless the data contradicts it (`REGIME_MISMATCH`). Returns (final, source).
pub fn accept_ai(ai: Regime, det: Regime, c: f64, r: &Row) -> (Regime, &'static str) {
    let mismatch = (matches!(ai, Regime::TrendUp | Regime::Range) && c < r.sma200) || (ai == Regime::HighVol && r.atrp_rank < 0.6);
    if mismatch { (det, "override_rejected") } else { (ai, "ai") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_mismatch_rejected() {
        let r = Row { sma200: 100., atrp_rank: 0.3, ..Default::default() };
        assert_eq!(accept_ai(Regime::TrendUp, Regime::TrendDown, 90., &r), (Regime::TrendDown, "override_rejected"));
        assert_eq!(accept_ai(Regime::HighVol, Regime::Range, 110., &r), (Regime::Range, "override_rejected"));
        assert_eq!(accept_ai(Regime::Range, Regime::TrendUp, 110., &r), (Regime::Range, "ai"));
    }
}
