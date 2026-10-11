//! Engine loop (spec §4): prices refresh every PRICE_EVERY_S (default 10s) and stream to the dashboard;
//! every 60s re-classify, manage exits/entries through the risk gate, mark to market.
use crate::brains::{entry_signal, entry_text, exit_check, size};
use crate::indicators::compute;
use crate::ledger::{close_pos, Position, FEE, SLIP};
use crate::regime::{accept_ai, regime};
use crate::risk::{gate, GateIn, Status};
use crate::state::World;
use crate::{executor, market, now, S};
use serde_json::{json, Value};
use std::time::Duration;

/// AI regime calls older than this are ignored (deterministic fallback).
const AI_FRESH_S: i64 = 7200;
/// Cool-down after an exit before the same sleeve may re-enter.
const REENTRY_COOLDOWN_S: i64 = 3600;
/// Same gate code on the same symbol is logged at most once per window.
const BLOCK_DEDUP_S: i64 = 600;

/// Seconds between trading ticks (regimes, entries, exits, risk gate).
const TRADE_EVERY_S: i64 = 60;

pub fn spawn(app: S) {
    tokio::spawn(async move {
        let mut last_trade = i64::MIN;
        loop {
            market::refresh(&app).await;
            if now() - last_trade >= TRADE_EVERY_S {
                last_trade = now();
                trade_once(&app).await;
            }
            tokio::time::sleep(Duration::from_secs(app.cfg.price_every_s)).await;
        }
    });
}

async fn trade_once(app: &S) {
    let (accounts, audit, mirror) = {
        let mut w = app.w.lock().unwrap();
        tick(&mut w, now());
        (serde_json::to_string(&w.accounts).ok(), serde_json::to_string(&(&w.audit, &w.anchors)).ok(), std::mem::take(&mut w.mirror_queue))
    };
    let dir = &app.cfg.data_dir;
    let _ = std::fs::create_dir_all(dir);
    if let Some(a) = audit { let _ = std::fs::write(format!("{dir}/audit.json"), a); }
    if let Some(s) = accounts { let _ = std::fs::write(format!("{dir}/state.json"), s); }
    for (sym, side, qty) in mirror { executor::mirror_order(app, &sym, &side, qty).await; }
}

/// One live tick: regimes, exits, entries, risk gate, marks, daily-loss guard. Pure over `World` + clock.
pub fn tick(w: &mut World, now: i64) {
    let mut out: Vec<(Option<String>, &str, String, Value)> = vec![];

    // 1–4: indicators, deterministic regime, AI acceptance
    for (sym, m) in w.markets.iter_mut() {
        let n = m.candles.len();
        if n < 2 { continue }
        m.inds = compute(&m.candles);
        let r = m.inds.row(n - 1);
        if !r.ready() { continue }
        let det = regime(m.price, &r);
        let (fin, src, conf) = match &m.ai {
            Some((ai, c, _, ts)) if now - ts < AI_FRESH_S => {
                let (f, s) = accept_ai(*ai, det, m.price, &r);
                (f, s, if s == "ai" { *c } else { 1. })
            }
            _ => (det, "fallback", 1.),
        };
        if fin != m.fin {
            out.push((None, "regime", format!("{sym}: {} → {}. Switching to the {} brain.", m.fin.label(), fin.label(), fin.brain().label()),
                json!({"symbol": sym, "from": m.fin, "to": fin, "brain": fin.brain(), "source": src})));
        }
        m.det = det; m.fin = fin; m.source = src.into(); m.conf = conf;
    }

    let px = w.prices();
    let kill = w.kill;
    for (uid, a) in w.accounts.iter_mut() {
        // 8: daily-loss auto-pause
        let eq0 = a.equity(&px);
        if now / 86400 != a.day { a.day = now / 86400; a.day_start_equity = eq0; }
        let day_loss = (a.day_start_equity - eq0) / a.day_start_equity;
        if a.status == Status::Active && day_loss >= a.limits.daily_loss {
            a.status = Status::Paused;
            out.push((Some(uid.clone()), "auto_pause",
                format!("Auto-paused: down {:.1}% today, your limit is {:.0}%.", day_loss * 100., a.limits.daily_loss * 100.), json!({})));
        }
        while a.order_times.front().is_some_and(|t| now - t > 60) { a.order_times.pop_front(); }

        let syms: Vec<String> = a.sleeves.keys().cloned().collect();
        for sym in syms {
            let Some(m) = w.markets.get(&sym) else { continue };
            let n = m.candles.len();
            if n < 2 { continue }
            let r = m.inds.row(n - 1);
            if !r.ready() { continue }
            let (price, v) = (m.price, m.candles[n - 1].v);

            // 6: stops/exits on the latest price. Only a kill switch blocks them.
            let sl = a.sleeves.get_mut(&sym).unwrap();
            if let Some(p) = sl.pos.as_mut() {
                if let Some(why) = exit_check(p, price, price, &r, (now - p.opened) as f64 / 86400.) {
                    if !kill && a.status != Status::Killed {
                        let q = p.qty;
                        if w.mirror_user.as_deref() == Some(uid.as_str()) { w.mirror_queue.push((sym.clone(), "sell".into(), q)); }
                        let (msg, data) = close_pos(&sym, sl, price * (1. - SLIP), why, now, &mut a.trades);
                        out.push((Some(uid.clone()), "order", msg, data));
                    }
                }
                continue;
            }

            // 5: entries for the routed brain
            let Some((brain, k)) = entry_signal(m.fin, price, v, &r) else { continue };
            if now - sl.last_exit < REENTRY_COOLDOWN_S { continue }
            let fill = price * (1. + SLIP);
            let q = size(brain, sl.cash, fill, &r, &a.limits, m.conf);
            if q * fill < 10. { continue }
            let eq = a.equity(&px);
            let expo = a.exposure(&px);
            let sl = a.sleeves.get_mut(&sym).unwrap();

            // 7: risk gate, timed
            let gi = GateIn { buy: true, killed_global: kill, status: a.status, symbol_ok: true, price_age_s: now - m.updated,
                orders_last_min: a.order_times.len(), cash: sl.cash, notional: q * fill, pos_after: q * fill, sleeve_eq: sl.cash,
                exposure_after: expo + q * fill, equity: eq, day_loss };
            let t0 = std::time::Instant::now();
            let res = gate(&gi, &a.limits);
            let ns = t0.elapsed().as_nanos() as u64;
            match res {
                Err(code) => {
                    let fresh = a.last_block.get(&sym).is_none_or(|(c, t)| c != code || now - t > BLOCK_DEDUP_S);
                    if code != "PAUSED" && code != "KILL_SWITCH" && fresh {
                        a.last_block.insert(sym.clone(), (code.to_string(), now));
                        out.push((Some(uid.clone()), "gate_block", format!("Blocked {} buy of {sym}: {code}", brain.label()),
                            json!({"code": code, "latency_ns": ns, "symbol": sym})));
                    }
                }
                Ok(()) => {
                    let cost = q * fill * (1. + FEE);
                    sl.cash -= cost;
                    a.order_times.push_back(now);
                    if w.mirror_user.as_deref() == Some(uid.as_str()) { w.mirror_queue.push((sym.clone(), "buy".into(), q)); }
                    let stop = fill - k * r.atr;
                    sl.pos = Some(Position { qty: q, entry: fill, cost, brain, regime: m.fin, stop, hi: fill, opened: now, thesis: None });
                    out.push((Some(uid.clone()), "order",
                        format!("Bought {q:.4} {sym} at ${fill:.2}. {} brain: {}. Stop ${stop:.2}.", brain.label(), entry_text(brain, &sym, price, v, &r)),
                        json!({"side": "buy", "symbol": sym, "qty": q, "price": fill, "brain": brain, "regime": m.fin, "gate": "OK",
                            "latency_ns": ns, "confidence": m.conf})));
                }
            }
        }

        // mark to market every 5 min
        let e = a.equity(&px);
        if a.equity.last().is_none_or(|(t, _)| now - t >= 300) {
            a.equity.push((now, e));
            if a.equity.len() > 5000 { a.equity.remove(0); }
        }
    }
    for (acct, kind, msg, data) in out { w.emit(acct.as_deref(), kind, msg, data); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indicators::Candle;
    use crate::ledger::Account;
    use crate::regime::Regime;
    use crate::state::Market;
    use std::collections::HashMap;

    /// 400 daily bars of a steady uptrend with noise, so every indicator is warmed up.
    fn world_with_market(ai: Option<(Regime, i64)>) -> World {
        let cs: Vec<Candle> = (0..400).map(|i| {
            let c = 100. + i as f64 * 0.5 + ((i as f64) * 0.7).sin() * 3.;
            Candle { t: i * 86400, o: c - 0.5, h: c + 2., l: c - 2., c, v: 1000. }
        }).collect();
        let (tx, _) = tokio::sync::broadcast::channel(16);
        let mut w = World::new(tx, HashMap::new(), vec![], vec![], None);
        let price = cs.last().unwrap().c;
        let now = cs.last().unwrap().t;
        w.markets.insert("BTC".into(), Market { inds: compute(&cs), candles: cs, price, updated: now, det: Regime::Range, fin: Regime::Range,
            source: "fallback".into(), conf: 1., feed: "live".into(), ai: ai.map(|(r, age)| (r, 0.9, "test".into(), now - age)) });
        w.accounts.insert("u".into(), Account::new("u", "balanced", 10_000., 1000., 12., &["BTC".into()], now));
        w
    }

    /// Acceptance 4: no (or stale) AI call → engine keeps running on the deterministic regime.
    #[test]
    fn llm_down_falls_back_to_deterministic() {
        for ai in [None, Some((Regime::HighVol, AI_FRESH_S + 1))] {
            let mut w = world_with_market(ai);
            let now = w.markets["BTC"].updated;
            tick(&mut w, now);
            let m = &w.markets["BTC"];
            assert_eq!(m.source, "fallback");
            assert_eq!(m.fin, m.det);
        }
    }

    /// A fresh AI call that the data contradicts is overridden.
    #[test]
    fn fresh_ai_contradicting_data_is_rejected() {
        let mut w = world_with_market(Some((Regime::HighVol, 60)));
        let now = w.markets["BTC"].updated;
        tick(&mut w, now);
        let m = &w.markets["BTC"];
        assert_eq!(m.source, "override_rejected");
        assert_eq!(m.fin, m.det);
    }

    /// Acceptance 5: the kill switch blocks every new order within one tick.
    #[test]
    fn kill_switch_blocks_new_orders() {
        let mut w = world_with_market(None);
        w.kill = true;
        let now = w.markets["BTC"].updated;
        for i in 0..5 { tick(&mut w, now + i * 60); }
        assert!(w.accounts["u"].sleeves["BTC"].pos.is_none());
    }
}
