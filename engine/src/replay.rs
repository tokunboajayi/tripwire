//! Replay mode (spec §7): the same brains on historical daily bars, streamed at N days/second.
//! Signal on close of bar i, fill at open of bar i+1 — no look-ahead (v2 backtest semantics).
use crate::brains::{entry_signal, entry_text, exit_check, size};
use crate::indicators::{compute_ann, Candle, Inds};
use crate::ledger::{close_pos, Position, Sleeve, Trade, FEE, SLIP};
use crate::regime::{regime, Regime};
use crate::risk::Limits;
use crate::state::Replay;
use crate::S;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Duration;

pub const REPLAY_CASH: f64 = 10_000.;

pub type Dataset = Vec<(String, Vec<Candle>, Inds)>;

pub fn step(sym: &str, sl: &mut Sleeve, cs: &[Candle], ind: &Inds, i: usize, lim: &Limits, trades: &mut Vec<Trade>) -> Option<(String, Value)> {
    let (b, nx) = (cs[i], cs[i + 1]);
    let r = ind.row(i);
    if !r.ready() { return None }
    let mut ev = None;
    if let Some(p) = sl.pos.as_mut() {
        if let Some(why) = exit_check(p, b.c, b.l, &r, ((b.t - p.opened) / 86400) as f64) {
            let px = if why == "stop" { nx.o.min(p.stop) } else { nx.o } * (1. - SLIP);
            ev = Some(close_pos(sym, sl, px, why, nx.t, trades));
        }
    }
    if sl.pos.is_none() {
        let reg = regime(b.c, &r);
        if let Some((brain, k)) = entry_signal(reg, b.c, b.v, &r) {
            let px = nx.o * (1. + SLIP);
            let q = size(brain, sl.cash, px, &r, lim, 1.);
            if q > 0. {
                let cost = q * px * (1. + FEE);
                sl.cash -= cost;
                sl.pos = Some(Position { qty: q, entry: px, cost, brain, regime: reg, stop: px - k * r.atr, hi: px, opened: nx.t, thesis: None });
                ev = Some((format!("Bought {sym} at ${px:.2}. {} brain: {}.", brain.label(), entry_text(brain, sym, b.c, b.v, &r)),
                    json!({"side": "buy", "symbol": sym, "price": px, "brain": brain})));
            }
        }
    }
    ev
}

/// Stocks dataset written by data/fetch_stocks.py.
pub fn load_stocks(dir: &str) -> Option<Dataset> {
    let m: BTreeMap<String, Vec<Candle>> = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/stocks.json")).ok()?).ok()?;
    let v: Dataset = m.into_iter().filter(|(_, c)| c.len() > 300).map(|(s, c)| { let i = compute_ann(&c, 252.); (s, c, i) }).collect();
    if v.is_empty() { None } else { Some(v) }
}

/// Run a replay for `user` in the background, emitting `replay_*` events on the user's stream.
pub fn spawn(app: S, user: String, data: Dataset, lim: Limits, from: i64, speed: f64, gen: u64) {
    tokio::spawn(async move {
        let rid = format!("replay:{user}");
        let per = REPLAY_CASH / data.len() as f64;
        let mut sleeves: Vec<Sleeve> = data.iter().map(|_| Sleeve { cash: per, ..Default::default() }).collect();
        let mut trades = vec![];
        let start: Vec<usize> = data.iter().map(|(_, cs, _)| cs.iter().position(|c| c.t >= from).unwrap_or(cs.len())).collect();
        let base: Vec<f64> = data.iter().zip(&start).map(|((_, cs, _), &i)| cs.get(i).map_or(1., |c| c.c)).collect();
        let days = data.iter().zip(&start).map(|((_, cs, _), &i)| cs.len().saturating_sub(i + 2)).min().unwrap_or(0);
        // last regime per symbol, so the dashboard can show each brain switch as it happens
        let mut last_reg: Vec<Option<Regime>> = vec![None; data.len()];
        for d in 0..days {
            let current = app.w.lock().unwrap().replays.get(&user).is_some_and(|r| r.gen == gen && r.status == "running");
            if !current { return } // stopped, or superseded by a newer run
            let mut evs = vec![];
            let mut switches = vec![];
            let (mut eq, mut bh, mut t) = (0., 0., 0);
            let mut regimes = serde_json::Map::new();
            for (k, (s, cs, ind)) in data.iter().enumerate() {
                let i = start[k] + d;
                let c = cs[i + 1];
                if let Some((m, mut dta)) = step(s, &mut sleeves[k], cs, ind, i, &lim, &mut trades) {
                    dta["t"] = json!(c.t);
                    evs.push((m, dta));
                }
                let row = ind.row(i);
                if row.ready() {
                    let reg = regime(cs[i].c, &row);
                    if let Some(prev) = last_reg[k].filter(|p| *p != reg) {
                        switches.push((format!("{s}: {} → {}. Switching to the {} brain.", prev.label(), reg.label(), reg.brain().label()),
                            json!({"symbol": s, "from": prev, "to": reg, "brain": reg.brain(), "t": c.t})));
                    }
                    last_reg[k] = Some(reg);
                    regimes.insert(s.clone(), json!({"regime": reg, "brain": reg.brain(), "price": c.c}));
                }
                t = c.t;
                eq += sleeves[k].cash + sleeves[k].pos.as_ref().map_or(0., |p| p.qty * c.c);
                bh += per * c.c / base[k];
            }
            {
                let mut w = app.w.lock().unwrap();
                match w.replays.get_mut(&user) {
                    Some(r) if r.gen == gen => { r.equity.push((t, eq)); r.buy_hold.push((t, bh)); r.trades = trades.clone(); }
                    _ => return,
                }
                for (m, dta) in switches { w.emit(Some(&rid), "replay_regime", m, dta); }
                for (m, dta) in evs { w.emit(Some(&rid), "replay_order", m, dta); }
                w.emit(Some(&rid), "replay_tick", String::new(), json!({"t": t, "equity": eq, "buy_hold": bh, "regimes": regimes}));
            }
            tokio::time::sleep(Duration::from_secs_f64(1. / speed)).await;
        }
        let mut w = app.w.lock().unwrap();
        match w.replays.get_mut(&user) {
            Some(r) if r.gen == gen => r.status = "done".into(),
            _ => return,
        }
        w.emit(Some(&rid), "replay_done", "Replay finished.".into(), json!({}));
    });
}

pub fn running(r: Option<&Replay>) -> bool { r.is_some_and(|r| r.status == "running") }
