//! The 3 brains + shield (spec §4 steps 5–6): entries, exits, sizing, and the one-line "why".
use crate::indicators::Row;
use crate::ledger::Position;
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

/// Position size in units. Agent confidence (0.5–1.0) scales it down, never above the profile cap.
pub fn size(brain: Brain, cash: f64, px: f64, r: &Row, lim: &Limits, conf: f64) -> f64 {
    let q = match brain {
        Brain::Trend => cash * lim.maxpos.min(lim.vol_target / r.rv) / px,
        Brain::Mr => (cash * lim.risk / (3. * r.atr)).min(cash * lim.maxpos / px),
        Brain::Breakout => (cash * lim.risk / (2. * r.atr)).min(cash * lim.maxpos / px),
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
        "flatten" => "you flattened the account".into(),
        x => x.into(),
    }
}

pub fn entry_text(b: Brain, sym: &str, c: f64, v: f64, r: &Row) -> String {
    match b {
        Brain::Mr => format!("calm market and {sym} is sharply oversold (RSI-2 {:.0}), buying the dip", r.rsi2),
        Brain::Trend => format!("strong uptrend (ADX {:.0}), riding it with a volatility-sized position", r.adx),
        Brain::Breakout => format!("volatility spike with a confirmed breakout on {:.1}x normal volume", v / r.vol20),
        Brain::Shield => format!("holding cash, {sym} is below its 200-day average ({c:.0})"),
    }
}
