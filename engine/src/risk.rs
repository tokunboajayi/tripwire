//! Risk gate (spec §5). Pure functions; every code is unit-tested.
use crate::ledger::{FEE, SLIP};
use serde::{Deserialize, Serialize};

/// Price older than this blocks new buys.
pub const STALE_AFTER_S: i64 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status { Active, Paused, Killed }

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Limits { pub risk: f64, pub maxpos: f64, pub vol_target: f64, pub exposure: f64, pub daily_loss: f64, pub max_orders_per_min: f64 }

impl Limits {
    /// Profile table from docs/01_IDEA.md.
    pub fn profile(p: &str) -> Limits {
        match p {
            "conservative" => Limits { risk: 0.01, maxpos: 0.5, vol_target: 0.25, exposure: 0.6, daily_loss: 0.02, max_orders_per_min: 6. },
            "aggressive" => Limits { risk: 0.03, maxpos: 1.0, vol_target: 0.60, exposure: 1.0, daily_loss: 0.06, max_orders_per_min: 6. },
            _ => Limits { risk: 0.02, maxpos: 0.75, vol_target: 0.40, exposure: 0.85, daily_loss: 0.04, max_orders_per_min: 6. },
        }
    }
    fn vals(&self) -> [f64; 6] { [self.risk, self.maxpos, self.vol_target, self.exposure, self.daily_loss, self.max_orders_per_min] }
}

pub const PROFILES: [&str; 3] = ["conservative", "balanced", "aggressive"];

/// Agents may only tighten limits; users may set anything up to the aggressive profile.
pub fn set_limits(cur: &Limits, req: &Limits, agent: bool) -> Result<Limits, &'static str> {
    let cap = if agent { *cur } else { Limits::profile("aggressive") };
    if req.vals().iter().zip(cap.vals()).any(|(r, c)| *r > c + 1e-12 || *r < 0.) { Err("LIMIT_LOOSEN_DENIED") } else { Ok(*req) }
}

pub struct GateIn {
    pub buy: bool, pub killed_global: bool, pub status: Status, pub symbol_ok: bool, pub price_age_s: i64,
    pub orders_last_min: usize, pub cash: f64, pub notional: f64, pub pos_after: f64, pub sleeve_eq: f64,
    pub exposure_after: f64, pub equity: f64, pub day_loss: f64,
}

/// First failure wins. Sells/exits are only ever blocked by a kill switch.
pub fn gate(g: &GateIn, lim: &Limits) -> Result<(), &'static str> {
    if g.killed_global || g.status == Status::Killed { return Err("KILL_SWITCH") }
    if !g.buy { return Ok(()) }
    if g.status == Status::Paused { return Err("PAUSED") }
    if !g.symbol_ok { return Err("SYMBOL_NOT_ALLOWED") }
    if g.price_age_s > STALE_AFTER_S { return Err("STALE_PRICE") }
    if g.orders_last_min as f64 >= lim.max_orders_per_min { return Err("RATE_LIMIT") }
    if g.notional * (1. + FEE + SLIP) > g.cash + 1e-9 { return Err("INSUFFICIENT_CASH") }
    if g.pos_after > lim.maxpos * g.sleeve_eq * 1.001 { return Err("POSITION_CAP") }
    if g.exposure_after > lim.exposure * g.equity * 1.001 { return Err("EXPOSURE_CAP") }
    if g.day_loss >= lim.daily_loss { return Err("DAILY_LOSS") }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gi() -> GateIn {
        GateIn { buy: true, killed_global: false, status: Status::Active, symbol_ok: true, price_age_s: 5, orders_last_min: 0,
            cash: 1000., notional: 100., pos_after: 100., sleeve_eq: 1000., exposure_after: 100., equity: 3000., day_loss: 0. }
    }

    #[test]
    fn gate_codes() {
        let l = Limits::profile("balanced");
        assert_eq!(gate(&gi(), &l), Ok(()));
        let cases: Vec<(Box<dyn Fn(&mut GateIn)>, &str)> = vec![
            (Box::new(|g| g.killed_global = true), "KILL_SWITCH"), (Box::new(|g| g.status = Status::Killed), "KILL_SWITCH"),
            (Box::new(|g| g.status = Status::Paused), "PAUSED"), (Box::new(|g| g.symbol_ok = false), "SYMBOL_NOT_ALLOWED"),
            (Box::new(|g| g.price_age_s = STALE_AFTER_S + 1), "STALE_PRICE"), (Box::new(|g| g.orders_last_min = 6), "RATE_LIMIT"),
            (Box::new(|g| g.notional = 2000.), "INSUFFICIENT_CASH"), (Box::new(|g| g.pos_after = 900.), "POSITION_CAP"),
            (Box::new(|g| g.exposure_after = 2900.), "EXPOSURE_CAP"), (Box::new(|g| g.day_loss = 0.05), "DAILY_LOSS"),
        ];
        for (f, code) in cases { let mut g = gi(); f(&mut g); assert_eq!(gate(&g, &l), Err(code)); }
    }

    #[test]
    fn exits_pass_caps() {
        let mut g = gi();
        g.buy = false; g.status = Status::Paused; g.day_loss = 0.5; g.price_age_s = 999;
        assert_eq!(gate(&g, &Limits::profile("conservative")), Ok(()));
        g.killed_global = true;
        assert_eq!(gate(&g, &Limits::profile("conservative")), Err("KILL_SWITCH"));
    }

    #[test]
    fn agent_cannot_loosen() {
        let cur = Limits::profile("conservative");
        let mut req = cur;
        req.risk = 0.02;
        assert_eq!(set_limits(&cur, &req, true), Err("LIMIT_LOOSEN_DENIED"));
        req.risk = 0.005;
        assert!(set_limits(&cur, &req, true).is_ok());
        assert!(set_limits(&cur, &Limits::profile("aggressive"), false).is_ok());
    }
}
