//! Broker (v2): the owner's account (MIRROR_USER) is also traded at Alpaca, paper or live, behind dollar guards
//! enforced here, on top of the risk gate. The simulated ledger stays the decision-maker; the broker mirrors each
//! decision at BROKER_CAPITAL_USD scale. Buys are notional market orders; sells close the whole broker position,
//! so the broker can never hold more than the ledger thinks (no qty drift from partial fills or fees).
//! Sync runs every trading tick: broker equity and positions in, daily dollar loss checked, halt if breached.
use crate::config::env_or;
use crate::{now, S};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Off, Paper, Live }

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s { "off" => Some(Mode::Off), "paper" => Some(Mode::Paper), "live" => Some(Mode::Live), _ => None }
    }
}

/// Real-money caps, in dollars. Applied in paper mode too, so paper is an exact rehearsal of live.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Guard { pub capital: f64, pub max_order: f64, pub max_deployed: f64, pub max_daily_loss: f64, pub max_orders_day: u32 }

impl Guard {
    /// Defaults scale with the capital: 10% per order, all of it deployable, 3% daily loss, 20 orders a day.
    pub fn from_env(capital: f64) -> Guard {
        let f = |k: &str, d: f64| env_or(k, "").parse::<f64>().ok().filter(|v| *v > 0.).unwrap_or(d);
        Guard { capital, max_order: f("LIVE_MAX_ORDER_USD", capital * 0.1), max_deployed: f("LIVE_MAX_DEPLOYED_USD", capital),
            max_daily_loss: f("LIVE_MAX_DAILY_LOSS_USD", capital * 0.03), max_orders_day: f("LIVE_MAX_ORDERS_PER_DAY", 20.) as u32 }
    }
}

/// Ladder for this run: kept if it was built for the same mode, otherwise a fresh one. Live starts at LADDER_START_USD
/// (default $200, never above the capital); paper is not capped, it only measures.
pub fn init_ladder(cfg: &crate::config::Cfg, saved: Option<crate::ladder::Ladder>, now: i64) -> Option<crate::ladder::Ladder> {
    if cfg.broker == Mode::Off { return None }
    let mode = if cfg.broker == Mode::Live { "live" } else { "paper" };
    if let Some(l) = saved.filter(|l| l.mode == mode) { return Some(l) }
    let start = if cfg.broker == Mode::Live {
        env_or("LADDER_START_USD", "200").parse::<f64>().ok().filter(|v| *v > 0.).unwrap_or(200.).min(cfg.guard.capital)
    } else { cfg.guard.capital };
    let mut l = crate::ladder::Ladder::new(start, now);
    l.mode = mode.into();
    Some(l)
}

/// The guard actually applied: in live mode the ladder's earned amount caps capital, deployment and order size.
pub fn effective_guard(app: &S) -> Guard {
    let mut g = app.cfg.guard;
    if app.cfg.broker == Mode::Live {
        if let Some(allowed) = app.w.lock().unwrap().ladder.as_ref().map(|l| l.allowed) {
            g.capital = g.capital.min(allowed);
            g.max_deployed = g.max_deployed.min(allowed);
            g.max_order = g.max_order.min(allowed);
            g.max_daily_loss = g.max_daily_loss.min(allowed * 0.03).max(1.);
        }
    }
    g
}

pub fn save_ladder(dir: &str, l: &Option<crate::ladder::Ladder>) {
    if let Ok(s) = serde_json::to_string(l) { let _ = std::fs::write(format!("{dir}/ladder.json"), s); }
}

/// Alpaca's crypto minimum is $1; below $2 a fee rounding can reject the order.
pub const MIN_ORDER_USD: f64 = 2.;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrokerPos { pub symbol: String, pub qty: f64, pub value: f64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Fill {
    pub ts: i64, pub symbol: String, pub side: String, pub notional: Option<f64>, pub ref_price: f64,
    pub fill_price: Option<f64>, pub slip_bps: Option<f64>, pub status: String, pub id: String,
}

/// Broker-side state. `halted` blocks new buys until the owner resumes; exits always go through.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Live {
    pub halted: Option<String>,
    pub day: i64,
    pub day_start_equity: Option<f64>,
    pub orders_today: u32,
    pub fills: VecDeque<Fill>,
    #[serde(skip_deserializing)] pub equity: Option<f64>,
    #[serde(skip_deserializing)] pub cash: Option<f64>,
    #[serde(skip_deserializing)] pub deployed: f64,
    #[serde(skip_deserializing)] pub positions: Vec<BrokerPos>,
    #[serde(skip_deserializing)] pub last_sync: i64,
    #[serde(skip_deserializing)] pub sync_error: Option<String>,
    #[serde(skip_deserializing)] pub drift: Vec<String>,
}

impl Live {
    /// New UTC day: reset the order count and take today's starting equity.
    pub fn roll_day(&mut self, now: i64) {
        if now / 86400 != self.day { self.day = now / 86400; self.orders_today = 0; self.day_start_equity = self.equity; }
        if self.day_start_equity.is_none() { self.day_start_equity = self.equity; }
    }
    pub fn day_loss(&self) -> f64 {
        match (self.day_start_equity, self.equity) { (Some(a), Some(b)) => (a - b).max(0.), _ => 0. }
    }
    fn push_fill(&mut self, f: Fill) {
        self.fills.push_back(f);
        if self.fills.len() > 50 { self.fills.pop_front(); }
    }
}

/// One decision from the ledger, waiting to be sent. `sim_notional` is in the account's simulated dollars.
#[derive(Clone, Debug)]
pub struct Order { pub sym: String, pub side: String, pub sim_notional: f64, pub start_cash: f64, pub ref_price: f64, pub id: String }

impl Order {
    pub fn new(sym: &str, side: &str, sim_notional: f64, start_cash: f64, ref_price: f64) -> Order {
        Order { sym: sym.into(), side: side.into(), sim_notional, start_cash, ref_price, id: format!("vt-{}", uuid::Uuid::new_v4().simple()) }
    }
    /// Same fraction of the broker capital as of the simulated account.
    pub fn scaled(&self, capital: f64) -> f64 { if self.start_cash > 0. { self.sim_notional * capital / self.start_cash } else { 0. } }
}

/// Size a buy against the dollar guards. Ok(notional) can be smaller than asked (capped); Err is a reason code.
pub fn check_buy(g: &Guard, st: &Live, want: f64) -> Result<f64, &'static str> {
    if st.halted.is_some() { return Err("LIVE_HALTED") }
    if st.equity.is_none() { return Err("LIVE_NOT_SYNCED") }
    if st.day_loss() >= g.max_daily_loss { return Err("LIVE_DAILY_LOSS") }
    if st.orders_today >= g.max_orders_day { return Err("LIVE_DAILY_ORDERS") }
    let room = g.max_deployed - st.deployed;
    if room < MIN_ORDER_USD { return Err("LIVE_DEPLOYED_CAP") }
    let cash = st.cash.unwrap_or(0.) * 0.99; // leave room for the fee
    if cash < MIN_ORDER_USD { return Err("LIVE_NO_CASH") }
    let n = want.min(g.max_order).min(room).min(cash);
    if n < MIN_ORDER_USD { return Err("LIVE_TOO_SMALL") }
    Ok((n * 100.).floor() / 100.)
}

/// HTTP request for an order: buys are notional market orders, sells close the whole position.
pub fn request(o: &Order, notional: f64) -> (Method, String, Option<Value>) {
    if o.side == "buy" {
        (Method::POST, "/v2/orders".into(), Some(json!({"symbol": format!("{}/USD", o.sym), "notional": format!("{notional:.2}"),
            "side": "buy", "type": "market", "time_in_force": "gtc", "client_order_id": o.id})))
    } else {
        (Method::DELETE, format!("/v2/positions/{}USD", o.sym), None)
    }
}

/// Base URL and keys for the mode. Live uses its own keys, so a paper key can never move real money (and vice versa).
fn creds(mode: Mode) -> Option<(String, String, String)> {
    let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    match mode {
        Mode::Off => None,
        Mode::Paper => Some((env_or("APCA_PAPER_URL", "https://paper-api.alpaca.markets"), get("APCA_API_KEY_ID")?, get("APCA_API_SECRET_KEY")?)),
        Mode::Live => Some((env_or("APCA_LIVE_URL", "https://api.alpaca.markets"), get("APCA_LIVE_KEY_ID")?, get("APCA_LIVE_SECRET_KEY")?)),
    }
}

pub fn keys_set(mode: Mode) -> bool { creds(mode).is_some() }

async fn call(app: &S, method: Method, path: &str, body: Option<&Value>) -> Result<Value, String> {
    let (base, k, s) = creds(app.cfg.broker).ok_or("broker keys not set")?;
    let mut rq = app.http.request(method, format!("{base}{path}")).header("APCA-API-KEY-ID", k).header("APCA-API-SECRET-KEY", s);
    if let Some(b) = body { rq = rq.json(b); }
    let r = rq.send().await.map_err(|e| format!("network: {e}"))?;
    let st = r.status();
    let txt = r.text().await.unwrap_or_default();
    if !st.is_success() { return Err(format!("HTTP {st}: {}", txt.chars().take(160).collect::<String>())) }
    Ok(serde_json::from_str(&txt).unwrap_or(Value::Null))
}

fn num(v: &Value) -> Option<f64> { v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())) }

fn label(mode: Mode) -> &'static str { if mode == Mode::Live { "LIVE" } else { "Alpaca paper" } }

fn emit(app: &S, msg: String, data: Value) {
    let mut w = app.w.lock().unwrap();
    let u = w.mirror_user.clone();
    w.emit(u.as_deref(), "mirror", msg, data);
}

/// Send queued orders. Buys pass the dollar guards first; sells always go (the ledger already exited).
pub async fn run(app: &S, orders: Vec<Order>) {
    let mode = app.cfg.broker;
    if mode == Mode::Off { return }
    let guard = effective_guard(app);
    for o in orders {
        let notional = if o.side == "buy" {
            let want = o.scaled(guard.capital);
            let checked = {
                let mut w = app.w.lock().unwrap();
                let r = check_buy(&guard, &w.live, want);
                if let Ok(n) = r { w.live.orders_today += 1; w.live.deployed += n; } // reserve now; the next sync corrects it
                r
            };
            match checked {
                Ok(n) => Some(n),
                Err(code) => {
                    emit(app, format!("{}: skipped buy of {} (${want:.2}): {code}. The paper ledger still took it.", label(mode), o.sym),
                        json!({"ok": false, "code": code, "symbol": o.sym, "side": "buy", "mode": mode}));
                    continue;
                }
            }
        } else { None };
        let (method, path, body) = request(&o, notional.unwrap_or(0.));
        // one retry on a network error; the client_order_id makes a duplicate buy impossible
        let mut res = call(app, method.clone(), &path, body.as_ref()).await;
        if matches!(&res, Err(e) if e.starts_with("network")) {
            tokio::time::sleep(Duration::from_secs(2)).await;
            res = call(app, method, &path, body.as_ref()).await;
        }
        match res {
            Ok(v) => {
                let id = v["id"].as_str().unwrap_or("?").to_string();
                let (status, fill_price) = poll_fill(app, &id, &v).await;
                let slip = fill_price.map(|f| (f / o.ref_price - 1.) * 1e4 * if o.side == "buy" { 1. } else { -1. });
                let what = match notional { Some(n) => format!("bought ${n:.2} of {}", o.sym), None => format!("sold all {}", o.sym) };
                let at = fill_price.map_or(String::new(), |f| format!(" at ${f:.2} (model ${:.2}, slippage {:+.0} bps)", o.ref_price, slip.unwrap_or(0.)));
                emit(app, format!("{}: {what}{at}. Order {status}.", label(mode)),
                    json!({"ok": true, "symbol": o.sym, "side": o.side, "notional": notional, "fill_price": fill_price, "slip_bps": slip, "mode": mode}));
                let mut w = app.w.lock().unwrap();
                w.live.push_fill(Fill { ts: now(), symbol: o.sym.clone(), side: o.side.clone(), notional,
                    ref_price: o.ref_price, fill_price, slip_bps: slip, status, id });
                if let Some(l) = w.ladder.as_mut() { l.on_fill(slip); }
            }
            Err(e) if o.side == "sell" && e.contains("404") => {
                emit(app, format!("{}: no {} position to sell (already flat).", label(mode), o.sym), json!({"ok": true, "symbol": o.sym, "side": "sell", "mode": mode}));
            }
            Err(e) => {
                if let Some(n) = notional { let mut w = app.w.lock().unwrap(); w.live.deployed -= n; }
                emit(app, format!("{}: {} {} failed: {e}", label(mode), o.side, o.sym), json!({"ok": false, "symbol": o.sym, "side": o.side, "mode": mode}));
            }
        }
    }
}

/// Market orders usually fill within a second; look a few times for the average fill price.
async fn poll_fill(app: &S, id: &str, first: &Value) -> (String, Option<f64>) {
    let mut v = first.clone();
    for _ in 0..4 {
        if v["status"] == "filled" { break }
        tokio::time::sleep(Duration::from_millis(750)).await;
        match call(app, Method::GET, &format!("/v2/orders/{id}"), None).await { Ok(x) => v = x, Err(_) => break }
    }
    (v["status"].as_str().unwrap_or("submitted").to_string(), num(&v["filled_avg_price"]))
}

/// Pull equity, cash and positions; enforce the daily dollar loss; flag ledger/broker drift.
pub async fn sync(app: &S) {
    if app.cfg.broker == Mode::Off { return }
    let res = async {
        let a = call(app, Method::GET, "/v2/account", None).await?;
        let p = call(app, Method::GET, "/v2/positions", None).await?;
        Ok::<_, String>((a, p))
    }.await;
    let t = now();
    let mut w = app.w.lock().unwrap();
    let (a, p) = match res {
        Ok(x) => x,
        Err(e) => { w.live.sync_error = Some(e); return }
    };
    let pos: Vec<BrokerPos> = p.as_array().into_iter().flatten().map(|x| BrokerPos {
        symbol: x["symbol"].as_str().unwrap_or("?").trim_end_matches("USD").trim_end_matches('/').to_string(),
        qty: num(&x["qty"]).unwrap_or(0.), value: num(&x["market_value"]).unwrap_or(0.),
    }).collect();
    w.live.sync_error = None;
    w.live.last_sync = t;
    w.live.equity = num(&a["equity"]);
    w.live.cash = num(&a["cash"]);
    w.live.deployed = pos.iter().map(|x| x.value.abs()).sum();
    w.live.positions = pos;
    w.live.roll_day(t);

    // drift: a position on one side only (the ledger decides, so this is a warning for the owner, not an action)
    let ledger: Vec<String> = w.mirror_user.as_ref().and_then(|u| w.accounts.get(u))
        .map(|acc| acc.sleeves.iter().filter(|(_, s)| s.pos.is_some()).map(|(k, _)| k.clone()).collect()).unwrap_or_default();
    let broker: Vec<String> = w.live.positions.iter().filter(|x| x.value.abs() >= 1.).map(|x| x.symbol.clone()).collect();
    let drift: Vec<String> = ledger.iter().filter(|s| !broker.contains(s)).map(|s| format!("{s}: ledger holds, broker flat"))
        .chain(broker.iter().filter(|s| !ledger.contains(s)).map(|s| format!("{s}: broker holds, ledger flat"))).collect();
    let new_drift = drift.iter().any(|d| !w.live.drift.contains(d));
    w.live.drift = drift.clone();

    let daily_cap = {
        let g = app.cfg.guard;
        if app.cfg.broker == Mode::Live { w.ladder.as_ref().map_or(g.max_daily_loss, |l| g.max_daily_loss.min(l.allowed * 0.03).max(1.)) } else { g.max_daily_loss }
    };
    let breach = w.live.halted.is_none() && w.live.day_loss() >= daily_cap;
    if breach { w.live.halted = Some("LIVE_DAILY_LOSS".into()); }
    let eq = w.live.equity;
    let mut ladder_stop = false;
    if let (Some(l), Some(e)) = (w.ladder.as_mut(), eq) {
        if breach { l.loss_halts.push_back(t); if l.loss_halts.len() > 50 { l.loss_halts.pop_front(); } }
        ladder_stop = l.on_equity(e) && app.cfg.broker == Mode::Live;
    }
    if ladder_stop && w.live.halted.is_none() { w.live.halted = Some("LADDER_STOP".into()); }
    let (loss, cap, mode) = (w.live.day_loss(), daily_cap, app.cfg.broker);
    let u = w.mirror_user.clone();
    if breach {
        w.emit(u.as_deref(), "mirror", format!("{}: halted. Down ${loss:.2} today, limit ${cap:.2}. No new buys until you resume; stops still run.", label(mode)),
            json!({"ok": false, "code": "LIVE_DAILY_LOSS", "mode": mode}));
    }
    if new_drift && !drift.is_empty() {
        w.emit(u.as_deref(), "mirror", format!("{}: ledger and broker disagree: {}.", label(mode), drift.join("; ")), json!({"ok": false, "code": "LIVE_DRIFT", "mode": mode}));
    }
    if ladder_stop {
        w.emit(u.as_deref(), "mirror", "Growth Ladder stop: down 10% from the peak on this rung. Buys halted. Review before resuming; the roadmap says go back to paper.".into(),
            json!({"ok": false, "code": "LADDER_STOP", "mode": mode}));
    }
    save(&app.cfg.data_dir, &w.live);
    save_ladder(&app.cfg.data_dir, &w.ladder);
}

/// Close every broker position and cancel open orders. Also halts new buys.
pub async fn flatten(app: &S) -> Result<(), String> {
    { app.w.lock().unwrap().live.halted = Some("FLATTENED".into()); }
    call(app, Method::DELETE, "/v2/positions?cancel_orders=true", None).await?;
    emit(app, format!("{}: flattened. Every broker position closed; buys halted until you resume.", label(app.cfg.broker)), json!({"ok": true, "mode": app.cfg.broker}));
    Ok(())
}

pub fn save(dir: &str, live: &Live) {
    let _ = std::fs::create_dir_all(dir);
    if let Ok(s) = serde_json::to_string(live) { let _ = std::fs::write(format!("{dir}/live.json"), s); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> Guard { Guard { capital: 500., max_order: 50., max_deployed: 400., max_daily_loss: 15., max_orders_day: 3 } }
    fn synced() -> Live { Live { equity: Some(500.), cash: Some(500.), day_start_equity: Some(500.), ..Default::default() } }

    #[test]
    fn buys_are_capped_and_checked() {
        let g = guard();
        assert_eq!(check_buy(&g, &synced(), 30.), Ok(30.));
        assert_eq!(check_buy(&g, &synced(), 120.), Ok(50.));                                  // per-order cap
        let mut s = synced(); s.deployed = 380.;
        assert_eq!(check_buy(&g, &s, 50.), Ok(20.));                                          // only the room left
        s.deployed = 399.;
        assert_eq!(check_buy(&g, &s, 50.), Err("LIVE_DEPLOYED_CAP"));
        let cases: Vec<(Box<dyn Fn(&mut Live)>, &str)> = vec![
            (Box::new(|s| s.halted = Some("x".into())), "LIVE_HALTED"),
            (Box::new(|s| s.equity = None), "LIVE_NOT_SYNCED"),
            (Box::new(|s| s.equity = Some(485.)), "LIVE_DAILY_LOSS"),
            (Box::new(|s| s.orders_today = 3), "LIVE_DAILY_ORDERS"),
            (Box::new(|s| s.cash = Some(1.)), "LIVE_NO_CASH"),
        ];
        for (f, code) in cases { let mut s = synced(); f(&mut s); assert_eq!(check_buy(&g, &s, 30.), Err(code), "{code}"); }
        assert_eq!(check_buy(&g, &synced(), 1.), Err("LIVE_TOO_SMALL"));
    }

    #[test]
    fn day_rolls_over() {
        let mut s = synced(); s.orders_today = 3; s.day = 10; s.equity = Some(470.);
        s.roll_day(10 * 86400 + 5);
        assert_eq!((s.orders_today, s.day_start_equity), (3, Some(500.)));                    // same day: unchanged
        s.roll_day(11 * 86400);
        assert_eq!((s.orders_today, s.day_start_equity, s.day_loss()), (0, Some(470.), 0.));  // new day: fresh budget
    }

    #[test]
    fn orders_scale_and_map_to_alpaca() {
        let o = Order::new("BTC", "buy", 1000., 10_000., 60_000.);
        assert_eq!(o.scaled(500.), 50.);
        let (m, p, b) = request(&o, 50.);
        assert_eq!((m, p.as_str()), (Method::POST, "/v2/orders"));
        let b = b.unwrap();
        assert_eq!((b["symbol"].as_str(), b["notional"].as_str(), b["client_order_id"].as_str()), (Some("BTC/USD"), Some("50.00"), Some(o.id.as_str())));
        let (m, p, b) = request(&Order::new("ETH", "sell", 0., 10_000., 3000.), 0.);
        assert_eq!((m, p.as_str(), b.is_none()), (Method::DELETE, "/v2/positions/ETHUSD", true));
    }
}
