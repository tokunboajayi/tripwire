//! Shared engine state + the event bus that feeds SSE and the why-log.
use crate::audit::{audit_hash, Anchor, Audit, AUDITED, GENESIS};
use crate::indicators::{Candle, Inds};
use crate::ledger::{Account, Trade};
use crate::regime::Regime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, VecDeque};
use tokio::sync::broadcast;

/// One why-log / SSE event. `account: None` = visible to everyone.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ev { pub id: u64, pub ts: i64, pub account: Option<String>, pub kind: String, pub msg: String, pub data: Value }

/// Latest AI regime call: (regime, confidence, reason, ts).
pub type AiCall = (Regime, f64, String, i64);

pub struct Market {
    pub candles: Vec<Candle>, pub inds: Inds, pub price: f64, pub updated: i64,
    pub det: Regime, pub fin: Regime, pub source: String, pub conf: f64, pub ai: Option<AiCall>,
    /// "live" or "offline" (fixture data).
    pub feed: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Replay {
    pub status: String, pub equity: Vec<(i64, f64)>, pub buy_hold: Vec<(i64, f64)>, pub trades: Vec<Trade>,
    /// Identifies one run, so a stopped run's loop can't keep writing into a newer run for the same user.
    #[serde(skip)] pub gen: u64,
}


pub struct World {
    pub markets: BTreeMap<String, Market>,
    pub accounts: HashMap<String, Account>,
    pub replays: HashMap<String, Replay>,
    pub kill: bool,
    pub events: VecDeque<Ev>,
    pub next_id: u64,
    pub tx: broadcast::Sender<Ev>,
    pub mirror_user: Option<String>,
    pub mirror_queue: Vec<crate::broker::Order>,
    pub live: crate::broker::Live,
    pub audit: Vec<Audit>,
    pub anchors: Vec<Anchor>,
}

impl World {
    pub fn new(tx: broadcast::Sender<Ev>, accounts: HashMap<String, Account>, audit: Vec<Audit>, anchors: Vec<Anchor>, mirror_user: Option<String>) -> Self {
        World { markets: BTreeMap::new(), accounts, replays: HashMap::new(), kill: false, events: VecDeque::new(), next_id: 0, tx,
            mirror_user, mirror_queue: vec![], live: Default::default(), audit, anchors }
    }

    /// Record an event: audit chain (if audited), account/global ring buffer, SSE broadcast.
    pub fn emit(&mut self, acct: Option<&str>, kind: &str, msg: String, data: Value) {
        self.next_id += 1;
        let ev = Ev { id: self.next_id, ts: chrono::Utc::now().timestamp(), account: acct.map(String::from), kind: kind.into(), msg, data };
        if AUDITED.contains(&kind) && !acct.is_some_and(|a| a.starts_with("replay:")) {
            let seq = self.audit.last().map_or(1, |e| e.seq + 1);
            let prev = self.audit.last().map_or(GENESIS.to_string(), |e| e.hash.clone());
            self.audit.push(Audit { seq, ts: ev.ts, kind: kind.into(), msg: ev.msg.clone(), hash: audit_hash(&prev, seq, ev.ts, kind, &ev.msg) });
        }
        let ring = match acct { None => Some(&mut self.events), Some(a) => self.accounts.get_mut(a).map(|a| &mut a.events) };
        if let Some(ring) = ring {
            ring.push_back(ev.clone());
            if ring.len() > 300 { ring.pop_front(); }
        }
        let _ = self.tx.send(ev);
    }

    pub fn prices(&self) -> HashMap<String, f64> { self.markets.iter().map(|(k, m)| (k.clone(), m.price)).collect() }

    /// Owner account only: the decision is also sent to the broker (see broker.rs).
    pub fn queue_mirror(&mut self, user: &str, sym: &str, side: &str, sim_notional: f64, price: f64) {
        if self.mirror_user.as_deref() != Some(user) { return }
        let start = self.accounts.get(user).map_or(0., |a| a.start_cash);
        self.mirror_queue.push(crate::broker::Order::new(sym, side, sim_notional, start, price));
    }
}
