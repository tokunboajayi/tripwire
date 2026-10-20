//! Growth Ladder: capital is earned, not assumed. In live mode the broker trades at most `allowed` dollars, whatever
//! BROKER_CAPITAL_USD says. `allowed` starts small (LADDER_START_USD) and can only be raised by the owner, at most 2×
//! per 30 days, and only when the measured record passes every gate. A drawdown past the stop line halts buys;
//! the drawdown gate clears again once equity makes a new high (backtest/ladder_sim.py showed a 10% line froze rungs for good).
//! The projection uses the measured return (never a hoped-for one), plus the owner's monthly contribution.
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const MAX_RAISE: f64 = 2.0;
/// 25%: v2 conservative's normal worst drop is ~17% and Trend Core's ~20–30%, so a tighter line just halts normal swings.
pub const STOP_DRAWDOWN: f64 = 0.25;
/// Backtest return used until there is enough live history: 2022–26 conservative, +17.5% over ~4.8 years.
pub const BACKTEST_ANNUAL: f64 = 0.034;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Raise { pub ts: i64, pub from: f64, pub to: f64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ladder {
    /// Broker mode this ladder was built for; switching paper → live starts a fresh ladder.
    #[serde(default)] pub mode: String,
    /// Dollars the live broker may trade.
    pub allowed: f64,
    /// When the current rung started (go-live or last raise); every gate counts from here.
    pub rung_start: i64,
    pub start_equity: Option<f64>,
    pub peak_equity: Option<f64>,
    pub max_drawdown: f64,
    /// Owner deposits/withdrawals since the rung started, so they don't count as returns.
    pub net_deposits: f64,
    pub fills: u32,
    pub slips: VecDeque<f64>,
    pub loss_halts: VecDeque<i64>,
    pub raises: Vec<Raise>,
    pub monthly_contribution: f64,
    pub target: f64,
}

impl Ladder {
    pub fn new(allowed: f64, now: i64) -> Ladder {
        Ladder { mode: String::new(), allowed, rung_start: now, start_equity: None, peak_equity: None, max_drawdown: 0., net_deposits: 0., fills: 0,
            slips: VecDeque::new(), loss_halts: VecDeque::new(), raises: vec![], monthly_contribution: 0., target: 1_000_000. }
    }

    /// Fresh rung: counters restart, the new record has to be earned at the new size.
    fn new_rung(&mut self, now: i64, equity: Option<f64>) {
        self.rung_start = now; self.start_equity = equity; self.peak_equity = equity; self.max_drawdown = 0.;
        self.net_deposits = 0.; self.fills = 0; self.slips.clear();
    }

    pub fn on_fill(&mut self, slip_bps: Option<f64>) {
        self.fills += 1;
        if let Some(s) = slip_bps { self.slips.push_back(s.abs()); if self.slips.len() > 200 { self.slips.pop_front(); } }
    }

    /// Feed broker equity. Returns true when the drawdown has just crossed the stop line.
    pub fn on_equity(&mut self, equity: f64) -> bool {
        if self.start_equity.is_none() { self.start_equity = Some(equity); }
        let adj = equity - self.net_deposits; // deposits don't make a new peak
        let peak = self.peak_equity.unwrap_or(adj).max(adj);
        if adj >= peak && self.peak_equity.is_some_and(|p| adj > p) { self.max_drawdown = 0.; } // recovered to a new high
        self.peak_equity = Some(peak);
        let dd = if peak > 0. { (peak - adj) / peak } else { 0. };
        let was = self.max_drawdown;
        self.max_drawdown = self.max_drawdown.max(dd);
        was < STOP_DRAWDOWN && self.max_drawdown >= STOP_DRAWDOWN
    }

    pub fn deposit(&mut self, usd: f64) { self.net_deposits += usd; }

    pub fn median_slip(&self) -> Option<f64> {
        if self.slips.is_empty() { return None }
        let mut v: Vec<f64> = self.slips.iter().copied().collect();
        v.sort_by(f64::total_cmp);
        Some(v[v.len() / 2])
    }

    /// Return on this rung, deposits excluded.
    pub fn rung_return(&self, equity: Option<f64>) -> Option<f64> {
        match (self.start_equity, equity) { (Some(s), Some(e)) if s > 0. => Some((e - self.net_deposits - s) / s), _ => None }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Gate { pub name: &'static str, pub ok: bool, pub value: String, pub need: String }

/// Every check a raise has to pass. `drift` = ledger/broker disagreement right now.
pub fn gates(l: &Ladder, equity: Option<f64>, drift: bool, now: i64) -> Vec<Gate> {
    let days = (now - l.rung_start) as f64 / 86400.;
    let since_raise = l.raises.last().map_or(f64::INFINITY, |r| (now - r.ts) as f64 / 86400.);
    let ret = l.rung_return(equity);
    let recent_halts = l.loss_halts.iter().filter(|t| now - **t < 14 * 86400).count();
    let g = |name, ok, value: String, need: &str| Gate { name, ok, value, need: need.into() };
    vec![
        g("Days on this rung", days >= 30., format!("{days:.0}"), "≥ 30"),
        g("Days since last raise", since_raise >= 30., if since_raise.is_finite() { format!("{since_raise:.0}") } else { "never".into() }, "≥ 30"),
        g("Broker fills", l.fills >= 10, l.fills.to_string(), "≥ 10"),
        g("Median slippage", l.median_slip().is_some_and(|s| s <= 15.), l.median_slip().map_or("—".into(), |s| format!("{s:.0} bps")), "≤ 15 bps"),
        g("Worst drawdown since last high", l.max_drawdown < STOP_DRAWDOWN, format!("{:.1}%", l.max_drawdown * 100.), "< 25%"),
        g("Return on this rung", ret.is_some_and(|r| r >= 0.), ret.map_or("—".into(), |r| format!("{:+.1}%", r * 100.)), "≥ 0%"),
        g("Daily-loss halts (14 days)", recent_halts == 0, recent_halts.to_string(), "0"),
        g("Ledger matches broker", !drift, if drift { "no".into() } else { "yes".into() }, "yes"),
    ]
}

/// Ok(new allowed) or the reason it's refused. A raise is capped at 2× and at the configured capital.
pub fn raise(l: &mut Ladder, to: f64, cap: f64, equity: Option<f64>, drift: bool, now: i64) -> Result<f64, String> {
    let failing: Vec<String> = gates(l, equity, drift, now).into_iter().filter(|g| !g.ok).map(|g| format!("{} ({}, need {})", g.name, g.value, g.need)).collect();
    if !failing.is_empty() { return Err(format!("not earned yet: {}", failing.join("; "))) }
    if to <= l.allowed { return Err("a raise must be above the current amount".into()) }
    if to > l.allowed * MAX_RAISE + 1e-9 { return Err(format!("at most 2× per raise (≤ ${:.0})", l.allowed * MAX_RAISE)) }
    if to > cap + 1e-9 { return Err(format!("above BROKER_CAPITAL_USD (${cap:.0}); raise that first, it is the hard ceiling")) }
    l.raises.push(Raise { ts: now, from: l.allowed, to });
    l.allowed = to;
    l.new_rung(now, equity);
    Ok(to)
}

/// Months to reach `target` from `start`, growing at `annual` and adding `monthly` each month. None if never (≤ 100 years).
pub fn months_to(start: f64, monthly: f64, annual: f64, target: f64) -> Option<u32> {
    if start >= target { return Some(0) }
    let r = (1. + annual).powf(1. / 12.) - 1.;
    let mut v = start;
    for m in 1..=1200 {
        v = v * (1. + r) + monthly;
        if v >= target { return Some(m) }
        if v <= 0. { return None }
    }
    None
}

/// Annualised return measured on this rung; None until there are at least 30 days of it.
pub fn measured_annual(l: &Ladder, equity: Option<f64>, now: i64) -> Option<f64> {
    let days = (now - l.rung_start) as f64 / 86400.;
    if days < 30. { return None }
    l.rung_return(equity).map(|r| (1. + r).max(0.).powf(365. / days) - 1.)
}

#[cfg(test)]
mod tests {
    use super::*;
    const D: i64 = 86400;

    fn earned(now: i64) -> Ladder {
        let mut l = Ladder::new(200., now - 40 * D);
        l.on_equity(200.); l.on_equity(206.);
        for _ in 0..12 { l.on_fill(Some(8.)); }
        l
    }

    #[test]
    fn raise_needs_every_gate_and_is_capped_at_2x() {
        let now = 100 * D;
        let mut l = earned(now);
        assert!(gates(&l, Some(206.), false, now).iter().all(|g| g.ok), "{:?}", gates(&l, Some(206.), false, now));
        assert!(raise(&mut l.clone(), 401., 1000., Some(206.), false, now).unwrap_err().contains("2×"));
        assert!(raise(&mut l.clone(), 400., 300., Some(206.), false, now).unwrap_err().contains("BROKER_CAPITAL_USD"));
        assert!(raise(&mut l.clone(), 400., 1000., Some(206.), true, now).unwrap_err().contains("Ledger matches broker"));
        assert_eq!(raise(&mut l, 400., 1000., Some(206.), false, now), Ok(400.));
        // the next raise starts from zero: new rung, 30 days, fresh fills
        let e = raise(&mut l, 800., 1000., Some(206.), false, now + D).unwrap_err();
        assert!(e.contains("Days on this rung") && e.contains("Days since last raise") && e.contains("Broker fills"), "{e}");
    }

    #[test]
    fn too_new_losing_or_sloppy_is_refused() {
        let now = 100 * D;
        let mut young = earned(now); young.rung_start = now - 5 * D;
        assert!(raise(&mut young, 400., 1000., Some(206.), false, now).unwrap_err().contains("Days on this rung"));
        let losing = earned(now);
        assert!(raise(&mut losing.clone(), 400., 1000., Some(190.), false, now).unwrap_err().contains("Return on this rung"));
        let mut sloppy = earned(now); for _ in 0..30 { sloppy.on_fill(Some(-40.)); }
        assert!(raise(&mut sloppy, 400., 1000., Some(206.), false, now).unwrap_err().contains("Median slippage"));
    }

    #[test]
    fn drawdown_trips_the_stop_once_and_deposits_are_not_profit() {
        let mut l = Ladder::new(500., 0);
        assert!(!l.on_equity(500.));
        assert!(!l.on_equity(400.));      // -20%
        assert!(l.on_equity(374.));       // -25.2%: crosses the line
        assert!(!l.on_equity(370.));      // already crossed, no repeat
        assert!(!l.on_equity(501.));      // new high: the drawdown gate clears
        assert_eq!(l.max_drawdown, 0.);
        assert!(l.on_equity(375.));       // and a fresh 25% drop trips it again
        let mut d = Ladder::new(500., 0);
        d.on_equity(500.); d.deposit(500.); d.on_equity(1000.);
        assert_eq!(d.rung_return(Some(1000.)), Some(0.));
        assert_eq!(d.max_drawdown, 0.);
    }

    #[test]
    fn projection_is_plain_compounding() {
        assert_eq!(months_to(1000., 0., 0.10, 1000.), Some(0));
        let m = months_to(0., 1000., 0.10, 1_000_000.).unwrap();
        assert!((270..=290).contains(&m), "{m}");                     // ~23 years at 10% + $1,000/month
        assert_eq!(months_to(1000., 0., 0.0, 1_000_000.), None);       // no return, no deposits: never
        assert_eq!(months_to(10_000., 0., BACKTEST_ANNUAL, 1_000_000.), None); // the backtest pace alone: over a century
    }
}
