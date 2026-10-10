//! Tripwire core: indicators, regimes, the 3 brains + shield, risk gate, ledger.
//! Indicator math mirrors backtest/v2.py exactly (see tests::parity).
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use tokio::sync::broadcast;

pub const FEE: f64 = 0.0025;
pub const SLIP: f64 = 0.0005;
const NAN: f64 = f64::NAN;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Candle { pub t: i64, pub o: f64, pub h: f64, pub l: f64, pub c: f64, pub v: f64 }

#[derive(Clone, Default, Debug)]
pub struct Inds {
    pub atr: Vec<f64>, pub ema50: Vec<f64>, pub ema200: Vec<f64>, pub sma200: Vec<f64>, pub sma5: Vec<f64>,
    pub adx: Vec<f64>, pub rsi2: Vec<f64>, pub dch10: Vec<f64>, pub dch20: Vec<f64>, pub vol20: Vec<f64>,
    pub rv: Vec<f64>, pub atrp_rank: Vec<f64>,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Row { pub atr: f64, pub ema50: f64, pub ema200: f64, pub sma200: f64, pub sma5: f64, pub adx: f64,
    pub rsi2: f64, pub dch10: f64, pub dch20: f64, pub vol20: f64, pub rv: f64, pub atrp_rank: f64 }
impl Inds {
    pub fn row(&self, i: usize) -> Row {
        Row { atr: self.atr[i], ema50: self.ema50[i], ema200: self.ema200[i], sma200: self.sma200[i], sma5: self.sma5[i],
            adx: self.adx[i], rsi2: self.rsi2[i], dch10: self.dch10[i], dch20: self.dch20[i], vol20: self.vol20[i],
            rv: self.rv[i], atrp_rank: self.atrp_rank[i] }
    }
}
impl Row { pub fn ready(&self) -> bool { !(self.ema200.is_nan() || self.atrp_rank.is_nan() || self.rv.is_nan() || self.sma200.is_nan()) } }

/// pandas .ewm(alpha, adjust=False).mean(): seeds at first non-NaN, holds through NaN.
fn ewm(x: &[f64], a: f64) -> Vec<f64> {
    let mut p: Option<f64> = None;
    x.iter().map(|&v| { if v.is_nan() { return p.unwrap_or(NAN); } let y = p.map_or(v, |p| (1. - a) * p + a * v); p = Some(y); y }).collect()
}
fn roll(x: &[f64], w: usize, minp: usize, f: impl Fn(&[f64], f64) -> f64) -> Vec<f64> {
    (0..x.len()).map(|i| {
        if x[i].is_nan() { return NAN; }
        let win: Vec<f64> = x[(i + 1).saturating_sub(w)..=i].iter().copied().filter(|v| !v.is_nan()).collect();
        if win.len() < minp { NAN } else { f(&win, x[i]) }
    }).collect()
}
fn mean(v: &[f64], _: f64) -> f64 { v.iter().sum::<f64>() / v.len() as f64 }
fn std1(v: &[f64], _: f64) -> f64 { let m = mean(v, 0.); (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (v.len() as f64 - 1.)).sqrt() }
fn pct_rank(v: &[f64], x: f64) -> f64 {
    let less = v.iter().filter(|&&y| y < x).count() as f64; let eq = v.iter().filter(|&&y| y == x).count() as f64;
    (less + (eq + 1.) / 2.) / v.len() as f64
}
fn prev_max(x: &[f64], w: usize) -> Vec<f64> {
    (0..x.len()).map(|i| if i >= w { x[i - w..i].iter().cloned().fold(f64::MIN, f64::max) } else { NAN }).collect()
}

pub fn compute(cs: &[Candle]) -> Inds {
    let n = cs.len();
    let (c, h, l, v): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>) =
        (cs.iter().map(|k| k.c).collect(), cs.iter().map(|k| k.h).collect(), cs.iter().map(|k| k.l).collect(), cs.iter().map(|k| k.v).collect());
    let tr: Vec<f64> = (0..n).map(|i| if i == 0 { h[0] - l[0] } else { (h[i] - l[i]).max((h[i] - c[i - 1]).abs()).max((l[i] - c[i - 1]).abs()) }).collect();
    let atr = ewm(&tr, 1. / 14.);
    let (mut pdm, mut ndm) = (vec![0.; n], vec![0.; n]);
    for i in 1..n { let up = h[i] - h[i - 1]; let dn = l[i - 1] - l[i]; if up > dn && up > 0. { pdm[i] = up } if dn > up && dn > 0. { ndm[i] = dn } }
    let (pe, ne) = (ewm(&pdm, 1. / 14.), ewm(&ndm, 1. / 14.));
    let dx: Vec<f64> = (0..n).map(|i| { let p = 100. * pe[i] / atr[i]; let q = 100. * ne[i] / atr[i]; 100. * (p - q).abs() / (p + q) }).collect();
    let g: Vec<f64> = (0..n).map(|i| if i == 0 { NAN } else { c[i] - c[i - 1] }).collect();
    let gain: Vec<f64> = g.iter().map(|&x| if x.is_nan() { NAN } else { x.max(0.) }).collect();
    let loss: Vec<f64> = g.iter().map(|&x| if x.is_nan() { NAN } else { -(x.min(0.)) }).collect();
    let (ge, le) = (ewm(&gain, 0.5), ewm(&loss, 0.5));
    let rsi2 = (0..n).map(|i| 100. - 100. / (1. + ge[i] / le[i])).collect();
    let rets: Vec<f64> = (0..n).map(|i| if i == 0 { NAN } else { c[i] / c[i - 1] - 1. }).collect();
    let atrp: Vec<f64> = (0..n).map(|i| atr[i] / c[i]).collect();
    Inds {
        ema50: ewm(&c, 2. / 51.), ema200: ewm(&c, 2. / 201.), sma200: roll(&c, 200, 200, mean), sma5: roll(&c, 5, 5, mean),
        adx: ewm(&dx, 1. / 14.), rsi2, dch10: prev_max(&h, 10), dch20: prev_max(&h, 20), vol20: roll(&v, 20, 20, mean),
        rv: roll(&rets, 30, 30, std1).iter().map(|x| x * 365f64.sqrt()).collect(), atrp_rank: roll(&atrp, 90, 30, pct_rank), atr,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Regime { Range, TrendUp, HighVol, TrendDown }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Brain { Mr, Trend, Breakout, Shield }
impl Regime {
    pub fn brain(self) -> Brain { match self { Regime::Range => Brain::Mr, Regime::TrendUp => Brain::Trend, Regime::HighVol => Brain::Breakout, Regime::TrendDown => Brain::Shield } }
    pub fn label(self) -> &'static str { match self { Regime::Range => "Calm", Regime::TrendUp => "Trending up", Regime::HighVol => "High volatility", Regime::TrendDown => "Falling" } }
}
impl Brain { pub fn label(self) -> &'static str { match self { Brain::Mr => "Mean-Reversion", Brain::Trend => "Trend", Brain::Breakout => "Breakout", Brain::Shield => "Shield" } } }

pub fn regime(c: f64, r: &Row) -> Regime {
    if r.atrp_rank > 0.85 { Regime::HighVol }
    else if r.adx > 25. && c > r.ema200 && r.ema50 > r.ema200 { Regime::TrendUp }
    else if c < r.sma200 { Regime::TrendDown }
    else { Regime::Range }
}
/// AI chooses, Rust verifies. Returns (final, source).
pub fn accept_ai(ai: Regime, det: Regime, c: f64, r: &Row) -> (Regime, &'static str) {
    let mismatch = (matches!(ai, Regime::TrendUp | Regime::Range) && c < r.sma200) || (ai == Regime::HighVol && r.atrp_rank < 0.6);
    if mismatch { (det, "override_rejected") } else { (ai, "ai") }
}

/// Entry rule for the routed brain; returns stop multiple of ATR.
pub fn entry_signal(reg: Regime, c: f64, v: f64, r: &Row) -> Option<(Brain, f64)> {
    match reg {
        Regime::TrendUp if c > r.ema50 && r.ema50 > r.ema200 => Some((Brain::Trend, 4.)),
        Regime::Range if r.rsi2 < 10. && c > r.sma200 => Some((Brain::Mr, 3.)),
        Regime::HighVol if c > r.dch10 && v > 1.5 * r.vol20 && c > r.ema50 => Some((Brain::Breakout, 2.)),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Limits { pub risk: f64, pub maxpos: f64, pub vol_target: f64, pub exposure: f64, pub daily_loss: f64, pub max_orders_per_min: f64 }
impl Limits {
    pub fn profile(p: &str) -> Limits {
        match p {
            "conservative" => Limits { risk: 0.01, maxpos: 0.5, vol_target: 0.25, exposure: 0.6, daily_loss: 0.02, max_orders_per_min: 6. },
            "aggressive" => Limits { risk: 0.03, maxpos: 1.0, vol_target: 0.60, exposure: 1.0, daily_loss: 0.06, max_orders_per_min: 6. },
            _ => Limits { risk: 0.02, maxpos: 0.75, vol_target: 0.40, exposure: 0.85, daily_loss: 0.04, max_orders_per_min: 6. },
        }
    }
    fn vals(&self) -> [f64; 6] { [self.risk, self.maxpos, self.vol_target, self.exposure, self.daily_loss, self.max_orders_per_min] }
}
/// Agents may only tighten limits; users may set anything up to the aggressive profile.
pub fn set_limits(cur: &Limits, req: &Limits, agent: bool) -> Result<Limits, &'static str> {
    let cap = if agent { *cur } else { Limits::profile("aggressive") };
    if req.vals().iter().zip(cap.vals()).any(|(r, c)| *r > c + 1e-12 || *r < 0.) { Err("LIMIT_LOOSEN_DENIED") } else { Ok(*req) }
}

pub fn size(brain: Brain, cash: f64, px: f64, r: &Row, lim: &Limits, conf: f64) -> f64 {
    let q = match brain {
        Brain::Trend => cash * lim.maxpos.min(lim.vol_target / r.rv) / px,
        Brain::Mr => (cash * lim.risk / (3. * r.atr)).min(cash * lim.maxpos / px),
        Brain::Breakout => (cash * lim.risk / (2. * r.atr)).min(cash * lim.maxpos / px),
        Brain::Shield => 0.,
    };
    (q * conf.clamp(0.5, 1.0)).max(0.)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Thesis { pub reason: String, pub invalidation: Vec<String>, pub confidence: f64 }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Position { pub qty: f64, pub entry: f64, pub cost: f64, pub brain: Brain, pub regime: Regime, pub stop: f64, pub hi: f64, pub opened: i64, pub thesis: Option<Thesis> }
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Sleeve { pub cash: f64, pub pos: Option<Position>, pub last_exit: i64 }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Trade { pub symbol: String, pub brain: Brain, pub regime: Regime, pub entry: f64, pub exit: f64, pub qty: f64, pub pnl: f64, pub ret: f64, pub reason: String, pub opened: i64, pub closed: i64 }

/// Exit rule. `c`/`l` are close/low (live: both = last price). Updates trailing state.
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
        "stop" => "stop-loss hit".into(), "target" => "bounced back above its 5-day average, taking profit".into(),
        "time" => "10 days without a bounce, time exit".into(), "trend_end" => "closed below its 50-day average, trend is over".into(),
        "flatten" => "you flattened the account".into(), x => x.into(),
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

/// Pure risk gate. Exits are only blocked by kill switches.
pub struct GateIn { pub buy: bool, pub killed_global: bool, pub status: Status, pub symbol_ok: bool, pub price_age_s: i64,
    pub orders_last_min: usize, pub cash: f64, pub notional: f64, pub pos_after: f64, pub sleeve_eq: f64, pub exposure_after: f64, pub equity: f64, pub day_loss: f64 }
pub fn gate(g: &GateIn, lim: &Limits) -> Result<(), &'static str> {
    if g.killed_global { return Err("KILL_SWITCH") }
    if g.status == Status::Killed { return Err("KILL_SWITCH") }
    if !g.buy { return Ok(()) }
    if g.status == Status::Paused { return Err("PAUSED") }
    if !g.symbol_ok { return Err("SYMBOL_NOT_ALLOWED") }
    if g.price_age_s > 180 { return Err("STALE_PRICE") }
    if g.orders_last_min as f64 >= lim.max_orders_per_min { return Err("RATE_LIMIT") }
    if g.notional * (1. + FEE + SLIP) > g.cash + 1e-9 { return Err("INSUFFICIENT_CASH") }
    if g.pos_after > lim.maxpos * g.sleeve_eq * 1.001 { return Err("POSITION_CAP") }
    if g.exposure_after > lim.exposure * g.equity * 1.001 { return Err("EXPOSURE_CAP") }
    if g.day_loss >= lim.daily_loss { return Err("DAILY_LOSS") }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status { Active, Paused, Killed }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ev { pub id: u64, pub ts: i64, pub account: Option<String>, pub kind: String, pub msg: String, pub data: Value }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Account {
    pub user: String, pub profile: String, pub limits: Limits, pub start_cash: f64, pub goal_amount: f64, pub goal_months: f64,
    pub created: i64, pub status: Status, pub sleeves: BTreeMap<String, Sleeve>, pub trades: Vec<Trade>, pub equity: Vec<(i64, f64)>,
    pub events: VecDeque<Ev>, pub order_times: VecDeque<i64>, pub day: i64, pub day_start_equity: f64, pub mcp_token: String, pub digest: Option<String>,
}
impl Account {
    pub fn new(user: &str, profile: &str, cash: f64, goal: f64, months: f64, syms: &[String], now: i64) -> Self {
        let per = cash / syms.len() as f64;
        Account { user: user.into(), profile: profile.into(), limits: Limits::profile(profile), start_cash: cash, goal_amount: goal, goal_months: months,
            created: now, status: Status::Active, sleeves: syms.iter().map(|s| (s.clone(), Sleeve { cash: per, ..Default::default() })).collect(),
            trades: vec![], equity: vec![(now, cash)], events: VecDeque::new(), order_times: VecDeque::new(), day: now / 86400, day_start_equity: cash,
            mcp_token: format!("tw_mcp_{}", uuid::Uuid::new_v4().simple()), digest: None }
    }
    pub fn equity(&self, px: &HashMap<String, f64>) -> f64 {
        self.sleeves.iter().map(|(s, sl)| sl.cash + sl.pos.as_ref().map_or(0., |p| p.qty * px.get(s).copied().unwrap_or(p.entry))).sum()
    }
}

pub struct Market { pub candles: Vec<Candle>, pub inds: Inds, pub price: f64, pub updated: i64, pub det: Regime, pub fin: Regime, pub source: String, pub conf: f64,
    pub ai: Option<(Regime, f64, String, i64)> }

#[derive(Clone, Debug, Default, Serialize)]
pub struct Replay { pub status: String, pub equity: Vec<(i64, f64)>, pub buy_hold: Vec<(i64, f64)>, pub trades: Vec<Trade> }

pub struct World {
    pub markets: BTreeMap<String, Market>, pub accounts: HashMap<String, Account>, pub replays: HashMap<String, Replay>,
    pub kill: bool, pub events: VecDeque<Ev>, pub next_id: u64, pub tx: broadcast::Sender<Ev>,
}
impl World {
    pub fn emit(&mut self, acct: Option<&str>, kind: &str, msg: String, data: Value) {
        self.next_id += 1;
        let ev = Ev { id: self.next_id, ts: chrono::Utc::now().timestamp(), account: acct.map(String::from), kind: kind.into(), msg, data };
        let ring = match acct { None => Some(&mut self.events), Some(a) => self.accounts.get_mut(a).map(|a| &mut a.events) };
        if let Some(ring) = ring { ring.push_back(ev.clone()); if ring.len() > 300 { ring.pop_front(); } }
        let _ = self.tx.send(ev);
    }
    pub fn prices(&self) -> HashMap<String, f64> { self.markets.iter().map(|(k, m)| (k.clone(), m.price)).collect() }

    /// One live tick: regimes, exits, entries, risk gate, marks, daily-loss guard.
    pub fn tick(&mut self, now: i64) {
        let mut out: Vec<(Option<String>, &str, String, Value)> = vec![];
        for (sym, m) in self.markets.iter_mut() {
            let n = m.candles.len(); if n < 2 { continue }
            m.inds = compute(&m.candles);
            let r = m.inds.row(n - 1); if !r.ready() { continue }
            let det = regime(m.price, &r);
            let (fin, src, conf) = match &m.ai {
                Some((ai, c, _, ts)) if now - ts < 7200 => { let (f, s) = accept_ai(*ai, det, m.price, &r); (f, s, if s == "ai" { *c } else { 1. }) }
                _ => (det, "fallback", 1.),
            };
            if fin != m.fin {
                out.push((None, "regime", format!("{sym}: {} → {}. Switching to the {} brain.", m.fin.label(), fin.label(), fin.brain().label()),
                    json!({"symbol": sym, "from": m.fin, "to": fin, "brain": fin.brain(), "source": src})));
            }
            m.det = det; m.fin = fin; m.source = src.into(); m.conf = conf;
        }
        let px = self.prices();
        let kill = self.kill;
        for (uid, a) in self.accounts.iter_mut() {
            let eq0 = a.equity(&px);
            if now / 86400 != a.day { a.day = now / 86400; a.day_start_equity = eq0; }
            let day_loss = (a.day_start_equity - eq0) / a.day_start_equity;
            if a.status == Status::Active && day_loss >= a.limits.daily_loss {
                a.status = Status::Paused;
                out.push((Some(uid.clone()), "auto_pause", format!("Auto-paused: down {:.1}% today, your limit is {:.0}%.", day_loss * 100., a.limits.daily_loss * 100.), json!({})));
            }
            while a.order_times.front().map_or(false, |t| now - t > 60) { a.order_times.pop_front(); }
            let syms: Vec<String> = a.sleeves.keys().cloned().collect();
            for sym in syms {
                let Some(m) = self.markets.get(&sym) else { continue };
                let n = m.candles.len(); if n < 2 { continue }
                let r = m.inds.row(n - 1); if !r.ready() { continue }
                let (price, v) = (m.price, m.candles[n - 1].v);
                // exits
                let sl = a.sleeves.get_mut(&sym).unwrap();
                if let Some(p) = sl.pos.as_mut() {
                    if let Some(why) = exit_check(p, price, price, &r, (now - p.opened) as f64 / 86400.) {
                        if !kill && a.status != Status::Killed {
                            let ev = close_pos(&sym, sl, price * (1. - SLIP), why, now, &mut a.trades);
                            out.push((Some(uid.clone()), "order", ev.0, ev.1));
                        }
                    }
                    continue;
                }
                // entries
                let Some((brain, k)) = entry_signal(m.fin, price, v, &r) else { continue };
                if now - sl.last_exit < 3600 { continue }
                let fill = price * (1. + SLIP);
                let q = size(brain, sl.cash, fill, &r, &a.limits, m.conf);
                if q * fill < 10. { continue }
                let eq = a.equity(&px);
                let expo: f64 = a.sleeves.iter().map(|(s, x)| x.pos.as_ref().map_or(0., |p| p.qty * px[s])).sum();
                let sl = a.sleeves.get_mut(&sym).unwrap();
                let gi = GateIn { buy: true, killed_global: kill, status: a.status, symbol_ok: true, price_age_s: now - m.updated, orders_last_min: a.order_times.len(),
                    cash: sl.cash, notional: q * fill, pos_after: q * fill, sleeve_eq: sl.cash, exposure_after: expo + q * fill, equity: eq, day_loss };
                let t0 = std::time::Instant::now(); let res = gate(&gi, &a.limits); let ns = t0.elapsed().as_nanos() as u64;
                match res {
                    Err(code) => {
                        if code != "PAUSED" && code != "KILL_SWITCH" {
                            out.push((Some(uid.clone()), "gate_block", format!("Blocked {} buy of {sym}: {code}", brain.label()), json!({"code": code, "latency_ns": ns, "symbol": sym})));
                        }
                    }
                    Ok(()) => {
                        let cost = q * fill * (1. + FEE); sl.cash -= cost; a.order_times.push_back(now);
                        let stop = fill - k * r.atr;
                        sl.pos = Some(Position { qty: q, entry: fill, cost, brain, regime: m.fin, stop, hi: fill, opened: now, thesis: None });
                        out.push((Some(uid.clone()), "order", format!("Bought {q:.4} {sym} at ${fill:.2}. {} brain: {}. Stop ${stop:.2}.", brain.label(), entry_text(brain, &sym, price, v, &r)),
                            json!({"side": "buy", "symbol": sym, "qty": q, "price": fill, "brain": brain, "regime": m.fin, "gate": "OK", "latency_ns": ns, "confidence": m.conf})));
                    }
                }
            }
            let e = a.equity(&px);
            if a.equity.last().map_or(true, |(t, _)| now - t >= 300) { a.equity.push((now, e)); if a.equity.len() > 5000 { a.equity.remove(0); } }
        }
        for (acct, kind, msg, data) in out { self.emit(acct.as_deref(), kind, msg, data); }
    }
}

pub fn close_pos(sym: &str, sl: &mut Sleeve, px: f64, why: &str, now: i64, trades: &mut Vec<Trade>) -> (String, Value) {
    let p = sl.pos.take().unwrap();
    let proceeds = p.qty * px * (1. - FEE); sl.cash += proceeds; sl.last_exit = now;
    let (pnl, ret) = (proceeds - p.cost, proceeds / p.cost - 1.);
    trades.push(Trade { symbol: sym.into(), brain: p.brain, regime: p.regime, entry: p.entry, exit: px, qty: p.qty, pnl, ret, reason: why.into(), opened: p.opened, closed: now });
    (format!("Sold {sym} at ${px:.2}: {}. P&L {}${:.2} ({:+.1}%).", exit_text(why), if pnl < 0. { "-" } else { "+" }, pnl.abs(), ret * 100.),
     json!({"side": "sell", "symbol": sym, "price": px, "pnl": pnl, "ret": ret, "reason": why, "brain": p.brain}))
}

/// v2 backtest semantics on completed daily bars (signal on close i, fill at open i+1). Used by replay.
pub fn replay_step(sym: &str, sl: &mut Sleeve, cs: &[Candle], ind: &Inds, i: usize, lim: &Limits, trades: &mut Vec<Trade>) -> Option<(String, Value)> {
    let (b, nx) = (cs[i], cs[i + 1]); let r = ind.row(i); if !r.ready() { return None }
    let mut ev = None;
    if let Some(p) = sl.pos.as_mut() {
        if let Some(why) = exit_check(p, b.c, b.l, &r, ((b.t - p.opened) / 86400) as f64) {
            let px = if why == "stop" { nx.o.min(p.stop) } else { nx.o } * (1. - SLIP);
            ev = Some(close_pos(sym, sl, px, why, nx.t, trades));
        }
    }
    if sl.pos.is_none() {
        if let Some((brain, k)) = entry_signal(regime(b.c, &r), b.c, b.v, &r) {
            let px = nx.o * (1. + SLIP); let q = size(brain, sl.cash, px, &r, lim, 1.);
            if q > 0. {
                let cost = q * px * (1. + FEE); sl.cash -= cost;
                sl.pos = Some(Position { qty: q, entry: px, cost, brain, regime: regime(b.c, &r), stop: px - k * r.atr, hi: px, opened: nx.t, thesis: None });
                ev = Some((format!("Bought {sym} at ${px:.2}. {} brain: {}.", brain.label(), entry_text(brain, sym, b.c, b.v, &r)),
                    json!({"side": "buy", "symbol": sym, "price": px, "brain": brain})));
            }
        }
    }
    ev
}

#[cfg(test)]
mod tests {
    use super::*;
    fn gi() -> GateIn { GateIn { buy: true, killed_global: false, status: Status::Active, symbol_ok: true, price_age_s: 5, orders_last_min: 0, cash: 1000., notional: 100., pos_after: 100., sleeve_eq: 1000., exposure_after: 100., equity: 3000., day_loss: 0. } }
    #[test] fn gate_codes() {
        let l = Limits::profile("balanced");
        assert_eq!(gate(&gi(), &l), Ok(()));
        let cases: Vec<(Box<dyn Fn(&mut GateIn)>, &str)> = vec![
            (Box::new(|g| g.killed_global = true), "KILL_SWITCH"), (Box::new(|g| g.status = Status::Killed), "KILL_SWITCH"),
            (Box::new(|g| g.status = Status::Paused), "PAUSED"), (Box::new(|g| g.symbol_ok = false), "SYMBOL_NOT_ALLOWED"),
            (Box::new(|g| g.price_age_s = 999), "STALE_PRICE"), (Box::new(|g| g.orders_last_min = 6), "RATE_LIMIT"),
            (Box::new(|g| g.notional = 2000.), "INSUFFICIENT_CASH"), (Box::new(|g| g.pos_after = 900.), "POSITION_CAP"),
            (Box::new(|g| g.exposure_after = 2900.), "EXPOSURE_CAP"), (Box::new(|g| g.day_loss = 0.05), "DAILY_LOSS"),
        ];
        for (f, code) in cases { let mut g = gi(); f(&mut g); assert_eq!(gate(&g, &l), Err(code)); }
    }
    #[test] fn exits_pass_caps() {
        let mut g = gi(); g.buy = false; g.status = Status::Paused; g.day_loss = 0.5; g.price_age_s = 999;
        assert_eq!(gate(&g, &Limits::profile("conservative")), Ok(()));
    }
    #[test] fn agent_cannot_loosen() {
        let cur = Limits::profile("conservative"); let mut req = cur; req.risk = 0.02;
        assert_eq!(set_limits(&cur, &req, true), Err("LIMIT_LOOSEN_DENIED"));
        req.risk = 0.005; assert!(set_limits(&cur, &req, true).is_ok());
        assert!(set_limits(&cur, &Limits::profile("aggressive"), false).is_ok());
    }
    #[test] fn ai_mismatch_rejected() {
        let r = Row { sma200: 100., atrp_rank: 0.3, ..Default::default() };
        assert_eq!(accept_ai(Regime::TrendUp, Regime::TrendDown, 90., &r), (Regime::TrendDown, "override_rejected"));
        assert_eq!(accept_ai(Regime::HighVol, Regime::Range, 110., &r), (Regime::Range, "override_rejected"));
        assert_eq!(accept_ai(Regime::Range, Regime::TrendUp, 110., &r), (Regime::Range, "ai"));
    }
    /// Rust indicators + regime == Python reference (backtest/fixtures/BTC_daily.csv from export_fixtures.py).
    #[test] fn parity() {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../backtest/fixtures/BTC_daily.csv");
        let Ok(txt) = std::fs::read_to_string(p) else { eprintln!("fixture missing, skipping"); return };
        let mut lines = txt.lines(); let hdr: Vec<&str> = lines.next().unwrap().split(',').collect();
        let rows: Vec<Vec<String>> = lines.map(|l| l.split(',').map(String::from).collect()).collect();
        let col = |r: &Vec<String>, k: &str| -> f64 { r[hdr.iter().position(|h| *h == k).unwrap()].parse().unwrap_or(NAN) };
        let cs: Vec<Candle> = rows.iter().map(|r| Candle { t: col(r, "t") as i64, o: col(r, "o"), h: col(r, "h"), l: col(r, "l"), c: col(r, "c"), v: col(r, "v") }).collect();
        let ind = compute(&cs); let mut checked = 0;
        for (i, r) in rows.iter().enumerate() {
            let row = ind.row(i);
            for (k, mine) in [("atr", row.atr), ("ema50", row.ema50), ("ema200", row.ema200), ("sma200", row.sma200), ("sma5", row.sma5), ("adx", row.adx),
                ("rsi2", row.rsi2), ("dch10", row.dch10), ("dch20", row.dch20), ("vol20", row.vol20), ("rv", row.rv), ("atrp_rank", row.atrp_rank)] {
                let py = col(r, k);
                if py.is_nan() { assert!(mine.is_nan(), "{k} row {i}: py NaN, rust {mine}"); continue }
                assert!((py - mine).abs() <= 1e-6 * py.abs().max(1.), "{k} row {i}: py {py} rust {mine}");
            }
            if row.ready() { let rg = serde_json::to_value(regime(cs[i].c, &row)).unwrap(); assert_eq!(rg.as_str().unwrap(), r[hdr.len() - 1], "regime row {i}"); checked += 1; }
        }
        assert!(checked > 1000, "only {checked} rows checked");
    }
}
