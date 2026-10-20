//! The 3 brains + shield (spec §4 steps 5–6): entries, exits, sizing, and the one-line "why".
//! Plus the Trend Core strategy: one rule, hold above the 100-day average (backtest/trend_core.py).
use crate::indicators::Row;
use crate::ledger::{Position, FEE, SLIP};
use crate::regime::{Brain, Regime};
use crate::risk::Limits;

/// Entry rule for the routed brain. Returns the brain and its stop distance in ATRs.
pub fn entry_signal(reg: Regime, c: f64, v: f64, r: &Row) -> Option<(Brain, f64)> {
    match reg {
        Regime::TrendUp if c > r.ema50 && r.ema50 > r.ema200 => Some((Brain::Trend, 4.)),
        Regime::Range if r.rsi2 < 10. && c > r.sma200 => Some((Brain::Mr, 3.)),
        Regime::HighVol if c > r.dch10 && v > 1.5 * r.vol20 && c > r.ema50 => Some((Brain::Breakout, 2.)),
        _ => None,
    }
}

pub const STRATEGIES: [&str; 2] = ["adaptive", "trend_core"];
/// Trend Core enters above SMA100 × (1 + band) and exits below SMA100 × (1 − band), so it doesn't whipsaw on the line.
pub const CORE_BAND: f64 = 0.01;
/// Trend Core's emergency stop, in ATRs below entry.
pub const CORE_STOP_ATR: f64 = 5.;

/// Entry for the account's strategy: `adaptive` routes by regime, `trend_core` ignores it.
pub fn entry_for(strategy: &str, reg: Regime, c: f64, v: f64, r: &Row) -> Option<(Brain, f64)> {
    if strategy == "trend_core" {
        return (!r.sma100.is_nan() && c > r.sma100 * (1. + CORE_BAND)).then_some((Brain::Core, CORE_STOP_ATR));
    }
    entry_signal(reg, c, v, r)
}

/// Position size in units. Agent confidence (0.5–1.0) scales it down, never above the profile cap.
pub fn size(brain: Brain, cash: f64, px: f64, r: &Row, lim: &Limits, conf: f64) -> f64 {
    let q = match brain {
        Brain::Trend => cash * lim.maxpos.min(lim.vol_target / r.rv) / px,
        Brain::Mr => (cash * lim.risk / (3. * r.atr)).min(cash * lim.maxpos / px),
        Brain::Breakout => (cash * lim.risk / (2. * r.atr)).min(cash * lim.maxpos / px),
        Brain::Core => cash * lim.maxpos / (px * (1. + FEE + SLIP)), // leave room for costs: the gate checks notional × (1+fee+slip) ≤ cash
        Brain::Shield => 0.,
    };
    (q * conf.clamp(0.5, 1.0)).max(0.)
}

/// Exit rule. `c`/`l` are close/low (live: both = last price). Updates the trailing stop.
pub fn exit_check(p: &mut Position, c: f64, l: f64, r: &Row, held_days: f64) -> Option<&'static str> {
    p.hi = p.hi.max(c);
    if l <= p.stop { return Some("stop") }
    match p.brain {
        Brain::Mr if c > r.sma5 => Some("target"),
        Brain::Mr if held_days >= 10. => Some("time"),
        Brain::Trend if c < r.ema50 => Some("trend_end"),
        Brain::Core if c < r.sma100 * (1. - CORE_BAND) => Some("core_end"),
        Brain::Breakout => { p.stop = p.stop.max(p.hi - 2. * r.atr); None }
        _ => None,
    }
}

pub fn exit_text(reason: &str) -> String {
    match reason {
        "stop" => "stop-loss hit".into(),
        "target" => "bounced back above its 5-day average, taking profit".into(),
        "time" => "10 days without a bounce, time exit".into(),
        "trend_end" => "closed below its 50-day average, trend is over".into(),
        "core_end" => "fell below its 100-day average, back to cash".into(),
        "flatten" => "you flattened the account".into(),
        x => x.into(),
    }
}

pub fn entry_text(b: Brain, sym: &str, c: f64, v: f64, r: &Row) -> String {
    match b {
        Brain::Mr => format!("calm market and {sym} is sharply oversold (RSI-2 {:.0}), buying the dip", r.rsi2),
        Brain::Trend => format!("strong uptrend (ADX {:.0}), riding it with a volatility-sized position", r.adx),
        Brain::Breakout => format!("volatility spike with a confirmed breakout on {:.1}x normal volume", v / r.vol20),
        Brain::Core => format!("{sym} is above its 100-day average ({:.0}), Trend Core holds it until it falls back below", r.sma100),
        Brain::Shield => format!("holding cash, {sym} is below its 200-day average ({c:.0})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trend_core_uses_a_band_around_the_100_day_average() {
        let r = Row { sma100: 100., atr: 2., ema50: 90., ema200: 80., sma5: 100., ..Default::default() };
        assert_eq!(entry_for("trend_core", Regime::TrendDown, 101.5, 1., &r), Some((Brain::Core, CORE_STOP_ATR)));
        assert_eq!(entry_for("trend_core", Regime::TrendUp, 100.5, 1., &r), None, "inside the band: no entry");
        let mut p = Position { qty: 1., entry: 102., cost: 102., brain: Brain::Core, regime: Regime::Range, stop: 92., hi: 102., opened: 0, thesis: None };
        assert_eq!(exit_check(&mut p, 99.5, 99.5, &r, 1.), None, "inside the band: hold");
        assert_eq!(exit_check(&mut p, 98.9, 98.9, &r, 1.), Some("core_end"));
        assert_eq!(exit_check(&mut p, 91., 91., &r, 1.), Some("stop"));
        let lim = Limits::profile("conservative");
        assert!((size(Brain::Core, 1000., 100., &r, &lim, 1.) * 100. - 500. / (1. + FEE + SLIP)).abs() < 1e-9, "half the sleeve on conservative");
        // aggressive = the whole sleeve, and the order still fits once fees and slippage are added
        let q = size(Brain::Core, 1000., 100., &r, &Limits::profile("aggressive"), 1.);
        assert!(q * 100. * (1. + FEE + SLIP) <= 1000. + 1e-9);
    }
}
