//! Accounts, positions, round-trip trades (spec §6). Fills are simulated on live prices.
use crate::brains::exit_text;
use crate::regime::{Brain, Regime};
use crate::risk::{Limits, Status};
use crate::state::Ev;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};

/// 0.25% fee and 5 bps slippage per side (FEE_BPS / SLIP_BPS in spec §13).
pub const FEE: f64 = 0.0025;
pub const SLIP: f64 = 0.0005;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Thesis { pub reason: String, pub invalidation: Vec<String>, pub confidence: f64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Position {
    pub qty: f64, pub entry: f64, pub cost: f64, pub brain: Brain, pub regime: Regime,
    pub stop: f64, pub hi: f64, pub opened: i64, pub thesis: Option<Thesis>,
}

/// Each symbol trades out of its own cash sleeve (same as the backtest).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Sleeve { pub cash: f64, pub pos: Option<Position>, pub last_exit: i64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Trade {
    pub symbol: String, pub brain: Brain, pub regime: Regime, pub entry: f64, pub exit: f64, pub qty: f64,
    pub pnl: f64, pub ret: f64, pub reason: String, pub opened: i64, pub closed: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Account {
    pub user: String, pub profile: String, pub limits: Limits, pub start_cash: f64, pub goal_amount: f64, pub goal_months: f64,
    pub created: i64, pub status: Status, pub sleeves: BTreeMap<String, Sleeve>, pub trades: Vec<Trade>, pub equity: Vec<(i64, f64)>,
    pub events: VecDeque<Ev>, pub order_times: VecDeque<i64>, pub day: i64, pub day_start_equity: f64, pub mcp_token: String,
    pub digest: Option<String>,
    #[serde(default)] pub last_block: HashMap<String, (String, i64)>,
    /// iMessage link: linked phone + pending 4-digit code (code, expires_ts).
    #[serde(default)] pub phone: Option<String>,
    #[serde(default)] pub link_code: Option<(String, i64)>,
}

impl Account {
    pub fn new(user: &str, profile: &str, cash: f64, goal: f64, months: f64, syms: &[String], now: i64) -> Self {
        let per = cash / syms.len() as f64;
        Account {
            user: user.into(), profile: profile.into(), limits: Limits::profile(profile), start_cash: cash, goal_amount: goal,
            goal_months: months, created: now, status: Status::Active,
            sleeves: syms.iter().map(|s| (s.clone(), Sleeve { cash: per, ..Default::default() })).collect(),
            trades: vec![], equity: vec![(now, cash)], events: VecDeque::new(), order_times: VecDeque::new(), day: now / 86400,
            day_start_equity: cash, mcp_token: format!("vt_mcp_{}", uuid::Uuid::new_v4().simple()), digest: None,
            last_block: HashMap::new(), phone: None, link_code: None,
        }
    }

    pub fn equity(&self, px: &HashMap<String, f64>) -> f64 {
        self.sleeves.iter().map(|(s, sl)| sl.cash + sl.pos.as_ref().map_or(0., |p| p.qty * px.get(s).copied().unwrap_or(p.entry))).sum()
    }

    pub fn exposure(&self, px: &HashMap<String, f64>) -> f64 {
        self.sleeves.iter().map(|(s, sl)| sl.pos.as_ref().map_or(0., |p| p.qty * px.get(s).copied().unwrap_or(p.entry))).sum()
    }
}

/// Close the sleeve's position at `px`, book the round trip, return the why-log line + payload.
pub fn close_pos(sym: &str, sl: &mut Sleeve, px: f64, why: &str, now: i64, trades: &mut Vec<Trade>) -> (String, Value) {
    let p = sl.pos.take().expect("close_pos on empty sleeve");
    let proceeds = p.qty * px * (1. - FEE);
    sl.cash += proceeds;
    sl.last_exit = now;
    let (pnl, ret) = (proceeds - p.cost, proceeds / p.cost - 1.);
    trades.push(Trade { symbol: sym.into(), brain: p.brain, regime: p.regime, entry: p.entry, exit: px, qty: p.qty, pnl, ret,
        reason: why.into(), opened: p.opened, closed: now });
    (format!("Sold {sym} at ${px:.2}: {}. P&L {}${:.2} ({:+.1}%).", exit_text(why), if pnl < 0. { "-" } else { "+" }, pnl.abs(), ret * 100.),
     json!({"side": "sell", "symbol": sym, "price": px, "pnl": pnl, "ret": ret, "reason": why, "brain": p.brain}))
}
