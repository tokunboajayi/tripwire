//! Prediction-market arbitrage engine (Kalshi + Polymarket). Runs its own fast loop (PM_EVERY_MS, default 2s),
//! independent of the 60s crypto tick: fetch books for every watched market, price every locked-in arb (arb.rs),
//! pass each through the guard below, then fill it (paper) or send it (live, Kalshi legs only).
//! Watch list = PM_PAIRS_FILE: cross-venue pairs and single-venue outcome groups. Only `verified: true` entries
//! trade: two venues can word the same event differently, and then the "locked" profit isn't locked.
pub mod alloc;
pub mod arb;
mod kalshi;
mod poly;

use crate::config::env_or;
use crate::{now, S};
use arb::{Arb, Fees, Quote, Venue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Off, Paper, Live }

#[derive(Clone, Debug, Serialize)]
pub struct Cfg {
    pub mode: Mode, pub every_ms: u64, pub pairs_file: String, pub min_edge_bps: f64, pub max_arb_usd: f64,
    pub max_exposure_usd: f64, pub max_per_hour: usize, pub cooldown_s: i64, pub settle_s: i64, pub fees: Fees, pub poly_url: String,
    pub paper_kalshi: f64, pub paper_poly: f64,
    #[serde(skip)] mode_raw: String, #[serde(skip)] confirm: String,
}

impl Cfg {
    pub fn from_env() -> Cfg {
        let f = |k: &str, d: f64| env_or(k, "").parse::<f64>().ok().filter(|v| *v >= 0.).unwrap_or(d);
        let mode_raw = env_or("PM_MODE", "off").to_lowercase();
        Cfg {
            mode: match mode_raw.as_str() { "paper" => Mode::Paper, "live" => Mode::Live, _ => Mode::Off },
            every_ms: (f("PM_EVERY_MS", 2000.) as u64).max(250),
            pairs_file: env_or("PM_PAIRS_FILE", &format!("{}/pairs.json", env_or("DATA_DIR", "./data"))),
            min_edge_bps: f("PM_MIN_EDGE_BPS", 150.), max_arb_usd: f("PM_MAX_ARB_USD", 50.), max_exposure_usd: f("PM_MAX_EXPOSURE_USD", 500.),
            max_per_hour: f("PM_MAX_ARBS_PER_HOUR", 30.) as usize, cooldown_s: f("PM_COOLDOWN_S", 30.) as i64, settle_s: f("PM_SETTLE_S", 60.) as i64,
            fees: Fees { kalshi_rate: f("KALSHI_FEE_RATE", 0.07), poly_bps: f("POLY_FEE_BPS", 0.) },
            poly_url: env_or("POLY_CLOB_URL", "https://clob.polymarket.com"),
            paper_kalshi: f("PM_PAPER_KALSHI_USD", 500.), paper_poly: f("PM_PAPER_POLY_USD", 500.),
            confirm: env_or("PM_LIVE_CONFIRM", ""), mode_raw,
        }
    }
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct Book { #[serde(default)] pub pairs: Vec<PairCfg>, #[serde(default)] pub groups: Vec<GroupCfg> }
#[derive(Deserialize, Clone, Debug)]
pub struct PairCfg { pub id: String, pub label: String, pub kalshi: String, pub poly_yes: String, pub poly_no: String, #[serde(default)] pub verified: bool }
#[derive(Deserialize, Clone, Debug)]
pub struct GroupCfg { pub id: String, pub label: String, pub venue: Venue, pub markets: Vec<String>, #[serde(default)] pub exhaustive: bool, #[serde(default)] pub verified: bool }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Position { pub id: String, pub arb: Arb, pub opened: i64, pub mode: String }

#[derive(Clone, Debug, Serialize)]
pub struct Opp { pub arb: Arb, pub status: String, pub ts: i64 }

#[derive(Default, Serialize)]
pub struct State {
    pub halted: Option<String>,
    pub balances: BTreeMap<Venue, f64>,
    pub positions: Vec<Position>,
    pub settled: VecDeque<Value>,
    pub opps: VecDeque<Opp>,
    pub realized: BTreeMap<Venue, f64>,
    pub missed: BTreeMap<Venue, f64>,
    pub locked: f64,
    pub last_cycle: i64, pub cycle_ms: u64, pub markets: usize, pub error: Option<String>,
    #[serde(skip)] last_trade: HashMap<String, i64>,
    #[serde(skip)] trades: VecDeque<i64>,
}

impl State {
    pub fn exposure(&self) -> f64 { self.positions.iter().map(|p| p.arb.cost + p.arb.fees).sum() }
}

pub struct Pm { pub cfg: Cfg, kalshi: kalshi::Kalshi, pub st: Mutex<State>, path: String }

/// What survives a restart.
#[derive(Serialize, Deserialize, Default)]
struct Saved {
    halted: Option<String>, balances: BTreeMap<Venue, f64>, positions: Vec<Position>, settled: VecDeque<Value>,
    realized: BTreeMap<Venue, f64>, missed: BTreeMap<Venue, f64>, locked: f64,
}

pub fn save(app: &S) {
    if app.pm.cfg.mode == Mode::Off { return }
    let s = {
        let st = app.pm.st.lock().unwrap();
        serde_json::to_string(&Saved { halted: st.halted.clone(), balances: st.balances.clone(), positions: st.positions.clone(), settled: st.settled.clone(),
            realized: st.realized.clone(), missed: st.missed.clone(), locked: st.locked })
    };
    if let Ok(s) = s { let _ = std::fs::write(&app.pm.path, s); }
}

pub const LIVE_CONFIRM_PHRASE: &str = "real-money";

impl Pm {
    pub fn from_env(dev: bool, has_owner: bool, data_dir: &str) -> Result<Pm, String> {
        let cfg = Cfg::from_env();
        if !matches!(cfg.mode_raw.as_str(), "off" | "paper" | "live") { return Err(format!("PM_MODE must be off, paper or live (got {:?})", cfg.mode_raw)) }
        let kalshi = kalshi::Kalshi::from_env()?;
        if cfg.mode == Mode::Live {
            if cfg.confirm != LIVE_CONFIRM_PHRASE { return Err(format!("PM_MODE=live trades real money. Set PM_LIVE_CONFIRM={LIVE_CONFIRM_PHRASE} to confirm")) }
            if dev { return Err("PM_MODE=live is not allowed with DEV=1".into()) }
            if !has_owner { return Err("PM_MODE=live needs OWNER_USER: someone has to be able to see, halt and kill it".into()) }
            if !kalshi.has_keys() { return Err("PM_MODE=live needs KALSHI_KEY_ID and KALSHI_PRIVATE_KEY(_PATH)".into()) }
            if cfg.max_arb_usd > cfg.max_exposure_usd { return Err("PM_MAX_ARB_USD can't exceed PM_MAX_EXPOSURE_USD".into()) }
        }
        let mut st = State::default();
        if cfg.mode == Mode::Paper { st.balances.insert(Venue::Kalshi, cfg.paper_kalshi); st.balances.insert(Venue::Polymarket, cfg.paper_poly); }
        // open sets, halt and books survive a restart; a file from the other mode is ignored
        let path = format!("{data_dir}/pm_{}.json", if cfg.mode == Mode::Live { "live" } else { "paper" });
        if let Some(s) = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<Saved>(&t).ok()) {
            st.halted = s.halted; st.positions = s.positions; st.settled = s.settled; st.realized = s.realized; st.missed = s.missed; st.locked = s.locked;
            if cfg.mode == Mode::Paper && !s.balances.is_empty() { st.balances = s.balances; }
        }
        Ok(Pm { cfg, kalshi, st: Mutex::new(st), path })
    }
}

/// The guard. First failure wins; Ok means the arb may be filled now.
pub fn guard(cfg: &Cfg, st: &State, a: &Arb, now: i64) -> Result<(), &'static str> {
    if st.halted.is_some() { return Err("PM_HALTED") }
    if cfg.mode == Mode::Live && a.legs.iter().any(|l| l.venue == Venue::Polymarket) { return Err("POLY_LIVE_UNSUPPORTED") }
    if st.last_trade.get(&a.id).is_some_and(|t| now - t < cfg.cooldown_s) { return Err("COOLDOWN") }
    if st.trades.iter().filter(|t| now - **t < 3600).count() >= cfg.max_per_hour { return Err("RATE_LIMIT") }
    if st.exposure() + a.cost + a.fees > cfg.max_exposure_usd + 1e-9 { return Err("PM_EXPOSURE_CAP") }
    for (v, need) in need_by_venue(a, &cfg.fees) {
        if st.balances.get(&v).copied().unwrap_or(0.) + 1e-9 < need { return Err("NO_CASH") }
    }
    Ok(())
}

fn need_by_venue(a: &Arb, fees: &Fees) -> BTreeMap<Venue, f64> {
    let mut m = BTreeMap::new();
    for l in &a.legs { *m.entry(l.venue).or_insert(0.) += a.contracts * l.price + fees.order(l.venue, a.contracts, l.price); }
    m
}

fn load_book(path: &str) -> Result<Book, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("{path}: {e}")),
        Err(_) => Ok(Book::default()),
    }
}

pub fn spawn(app: S) {
    if app.pm.cfg.mode == Mode::Off { return }
    tokio::spawn(async move {
        let mut book = Book::default();
        let mut loaded = 0i64;
        let (mut last_settle, mut last_balance) = (0i64, 0i64);
        loop {
            let t0 = Instant::now();
            if app.pm.cfg.mode == Mode::Live && now() - last_balance >= 15 {
                match app.pm.kalshi.balance(&app.http).await {
                    Ok(b) => { app.pm.st.lock().unwrap().balances.insert(Venue::Kalshi, b); }
                    Err(e) => app.pm.st.lock().unwrap().error = Some(e),
                }
                last_balance = now();
            }
            if now() - loaded >= 30 {
                match load_book(&app.pm.cfg.pairs_file) { Ok(b) => book = b, Err(e) => app.pm.st.lock().unwrap().error = Some(e) }
                loaded = now();
            }
            cycle(&app, &book).await;
            if now() - last_settle >= app.pm.cfg.settle_s { settle(&app).await; last_settle = now(); }
            let ms = t0.elapsed().as_millis() as u64;
            { let mut st = app.pm.st.lock().unwrap(); st.cycle_ms = ms; st.last_cycle = now(); }
            tokio::time::sleep(Duration::from_millis(app.pm.cfg.every_ms.saturating_sub(ms).max(50))).await;
        }
    });
}

/// One pass: fetch every book concurrently, price arbs, guard, fill.
async fn cycle(app: &S, book: &Book) {
    let pm = &app.pm;
    let mut need: Vec<(Venue, String)> = vec![];
    for p in &book.pairs { need.push((Venue::Kalshi, p.kalshi.clone())); need.push((Venue::Polymarket, p.poly_yes.clone())); need.push((Venue::Polymarket, p.poly_no.clone())); }
    for g in &book.groups { for m in &g.markets { need.push((g.venue, m.clone())); } }
    need.sort(); need.dedup();
    let fetched = futures::future::join_all(need.iter().map(|(v, m)| async move {
        let q = match v { Venue::Kalshi => pm.kalshi.quote(&app.http, m).await, Venue::Polymarket => poly::quote(&app.http, &pm.cfg.poly_url, m).await };
        ((*v, m.clone()), q)
    })).await;
    let mut quotes: HashMap<(Venue, String), Quote> = HashMap::new();
    let mut err = None;
    for (k, q) in fetched { match q { Ok(q) => { quotes.insert(k, q); } Err(e) => err = Some(e) } }

    let (c, f) = (&pm.cfg, &pm.cfg.fees);
    let mut found: Vec<(Arb, bool)> = vec![];
    for p in &book.pairs {
        let (Some(k), Some(py), Some(pn)) = (quotes.get(&(Venue::Kalshi, p.kalshi.clone())), quotes.get(&(Venue::Polymarket, p.poly_yes.clone())), quotes.get(&(Venue::Polymarket, p.poly_no.clone()))) else { continue };
        if let Some(a) = arb::cross(&p.id, &p.label, &p.kalshi, k, &p.poly_yes, &p.poly_no, py, pn, f, c.max_arb_usd, c.min_edge_bps) { found.push((a, p.verified)); }
    }
    for g in &book.groups {
        if !g.exhaustive { continue }
        let outs: Option<Vec<(String, Quote)>> = g.markets.iter().map(|m| quotes.get(&(g.venue, m.clone())).map(|q| (m.clone(), *q))).collect();
        if let Some(a) = outs.and_then(|o| arb::group(&g.id, &g.label, g.venue, &o, f, c.max_arb_usd, c.min_edge_bps)) { found.push((a, g.verified)); }
    }

    let t = now();
    let (mut live, mut paper): (Vec<Arb>, Vec<Arb>) = (vec![], vec![]);
    {
        let mut st = pm.st.lock().unwrap();
        st.markets = quotes.len();
        st.error = err;
        for (a, verified) in found {
            let r = if verified { guard(c, &st, &a, t) } else { Err("PAIR_UNVERIFIED") };
            if r == Err("COOLDOWN") { continue }
            if r == Err("NO_CASH") { for (v, _) in need_by_venue(&a, f) { *st.missed.entry(v).or_insert(0.) += a.profit / a.legs.len() as f64; } }
            let status: String = match r { Ok(()) => "taken".into(), Err(code) => code.into() };
            // the same block on the same event is listed once per 30s, so real changes stay visible
            if r.is_ok() || !st.opps.iter().any(|o| o.arb.id == a.id && o.status == status && t - o.ts < 30) {
                st.opps.push_front(Opp { arb: a.clone(), status, ts: t });
                st.opps.truncate(40);
            }
            if r.is_err() { continue }
            st.last_trade.insert(a.id.clone(), t);
            st.trades.push_back(t);
            while st.trades.front().is_some_and(|x| t - x > 3600) { st.trades.pop_front(); }
            if c.mode == Mode::Paper { book_fill(&mut st, &a, f, "paper"); paper.push(a); } else { live.push(a); }
        }
    }
    if !paper.is_empty() { save(app); }
    for a in &paper { emit_fill(app, a, "paper"); }
    for a in live { send_live(app, a).await; }
}

fn book_fill(st: &mut State, a: &Arb, f: &Fees, mode: &str) {
    for (v, need) in need_by_venue(a, f) { *st.balances.entry(v).or_insert(0.) -= need; }
    st.locked += a.profit;
    st.positions.push(Position { id: uuid::Uuid::new_v4().simple().to_string()[..10].to_string(), arb: a.clone(), opened: now(), mode: mode.into() });
}

fn emit_fill(app: &S, a: &Arb, mode: &str) {
    let legs: Vec<String> = a.legs.iter().map(|l| format!("{} {} @ {:.0}¢ on {}", a.contracts, if l.side == arb::Side::Yes { "YES" } else { "NO" }, l.price * 100., l.venue.label())).collect();
    let msg = format!("Arb ({mode}): {}. {}. Cost ${:.2} + fees ${:.2}, pays ${:.0} at resolution: +${:.2} locked ({:.1}%).",
        a.label, legs.join(" + "), a.cost, a.fees, a.contracts, a.profit, a.edge_bps / 100.);
    let mut w = app.w.lock().unwrap();
    let owner = app.cfg.owner.clone().or(w.mirror_user.clone());
    w.emit(owner.as_deref(), "pm", msg, json!({"arb": a, "mode": mode}));
}

/// Live: Kalshi legs only, each fill-or-kill. If a later leg fails after an earlier one filled, the set is no longer
/// hedged, so the engine halts and tells the owner exactly what is held. It never tries to "fix" it on its own.
async fn send_live(app: &S, a: Arb) {
    let mut filled = vec![];
    for (i, l) in a.legs.iter().enumerate() {
        let cid = format!("vt-{}-{i}-{}", a.id, uuid::Uuid::new_v4().simple());
        match app.pm.kalshi.buy(&app.http, &l.market, l.side, a.contracts, l.price, &cid).await {
            Ok(v) if !matches!(v["order"]["status"].as_str(), Some("canceled" | "cancelled")) => filled.push(l.market.clone()),
            res => {
                let why = match res { Err(e) => e, Ok(v) => format!("not filled ({})", v["order"]["status"]) };
                let mut st = app.pm.st.lock().unwrap();
                let msg = if filled.is_empty() { format!("Arb skipped: {} first leg {why}. Nothing held.", a.label) } else {
                    st.halted = Some("LEG_FAILED".into());
                    format!("HALTED: {} leg {} failed ({why}) after filling {}. You hold an unhedged position: review it on Kalshi.", a.label, l.market, filled.join(", "))
                };
                drop(st);
                save(app);
                let mut w = app.w.lock().unwrap();
                let owner = app.cfg.owner.clone().or(w.mirror_user.clone());
                w.emit(owner.as_deref(), "pm", msg, json!({"ok": false, "arb": a.id}));
                return;
            }
        }
    }
    { let mut st = app.pm.st.lock().unwrap(); let f = app.pm.cfg.fees; book_fill(&mut st, &a, &f, "live"); }
    save(app);
    emit_fill(app, &a, "live");
}

/// Close positions whose Kalshi markets have settled. Cross: the Kalshi leg's result says which venue won.
/// Group: the outcome that resolved YES pays. Polymarket-only groups settle by owner action
/// (POST /v1/pm/positions/:id/settle?venue=polymarket).
async fn settle(app: &S) {
    let open: Vec<Position> = app.pm.st.lock().unwrap().positions.clone();
    for p in open {
        if p.arb.kind == "group" {
            if p.arb.legs.first().is_none_or(|l| l.venue != Venue::Kalshi) { continue }
            for l in &p.arb.legs {
                if let Ok(Some(r)) = app.pm.kalshi.result(&app.http, &l.market).await {
                    if r == "yes" { close(app, &p.id, Venue::Kalshi, &format!("{} resolved YES", l.market)); break }
                }
            }
        } else if let Some(k) = p.arb.legs.iter().find(|l| l.venue == Venue::Kalshi) {
            if let Ok(Some(r)) = app.pm.kalshi.result(&app.http, &k.market).await {
                let kalshi_won = (r == "yes") == (k.side == arb::Side::Yes);
                close(app, &p.id, if kalshi_won { Venue::Kalshi } else { Venue::Polymarket }, &format!("{} settled {r}", k.market));
            }
        }
    }
}

/// Book the payout and realise the locked profit. Returns false if the position is unknown.
pub fn close(app: &S, id: &str, venue: Venue, why: &str) -> bool {
    let (msg, data) = {
        let mut st = app.pm.st.lock().unwrap();
        let Some(i) = st.positions.iter().position(|p| p.id == id) else { return false };
        let p = st.positions.remove(i);
        *st.balances.entry(venue).or_insert(0.) += p.arb.contracts;
        st.locked -= p.arb.profit;
        let n = p.arb.legs.len() as f64;
        for l in &p.arb.legs { *st.realized.entry(l.venue).or_insert(0.) += p.arb.profit / n; }
        let rec = json!({"id": p.id, "label": p.arb.label, "profit": p.arb.profit, "payout_venue": venue, "why": why, "ts": now()});
        st.settled.push_front(rec.clone());
        st.settled.truncate(50);
        (format!("Settled {}: ${:.0} paid on {}, profit +${:.2} realised ({why}).", p.arb.label, p.arb.contracts, venue.label(), p.arb.profit), rec)
    };
    save(app);
    let mut w = app.w.lock().unwrap();
    let owner = app.cfg.owner.clone().or(w.mirror_user.clone());
    w.emit(owner.as_deref(), "pm", msg, data);
    true
}

/// Status for the owner panel, including the allocator's view across every venue that holds money.
pub fn status(app: &S) -> Value {
    let pm = &app.pm;
    let crypto_eq = app.w.lock().unwrap().live.equity; // lock order: world first, never while holding PM state
    let st = pm.st.lock().unwrap();
    let mut books: Vec<alloc::VenueBook> = st.balances.iter().map(|(v, b)| alloc::VenueBook {
        venue: v.label().to_lowercase(), balance: *b + st.positions.iter().filter(|p| p.arb.legs.iter().any(|l| l.venue == *v)).map(|p| p.arb.cost / p.arb.legs.len() as f64).sum::<f64>(),
        realized: st.realized.get(v).copied().unwrap_or(0.), missed: st.missed.get(v).copied().unwrap_or(0.) }).collect();
    if let Some(eq) = crypto_eq {
        books.push(alloc::VenueBook { venue: "crypto".into(), balance: eq, realized: 0., missed: 0. });
    }
    let plan = alloc::allocate(&books, 0.1, 0.6, 25., 0.05);
    json!({"mode": pm.cfg.mode, "cfg": pm.cfg, "kalshi_keys": pm.kalshi.has_keys(), "state": &*st, "exposure": st.exposure(), "allocation": plan, "books": books})
}

#[cfg(test)]
mod tests {
    use super::*;
    use arb::{Leg, Side};

    fn cfg(mode: Mode) -> Cfg {
        Cfg { mode, every_ms: 1000, pairs_file: String::new(), min_edge_bps: 100., max_arb_usd: 50., max_exposure_usd: 100., max_per_hour: 2,
            cooldown_s: 30, settle_s: 60, fees: Fees { kalshi_rate: 0.07, poly_bps: 0. }, poly_url: String::new(), paper_kalshi: 0., paper_poly: 0.,
            mode_raw: String::new(), confirm: String::new() }
    }
    fn arb(id: &str, venues: &[Venue]) -> Arb {
        Arb { id: id.into(), label: id.into(), kind: "cross".into(), contracts: 40., cost: 36.8, fees: 0.7, profit: 2.5, edge_bps: 660.,
            legs: venues.iter().map(|v| Leg { venue: *v, market: "m".into(), side: Side::Yes, price: 0.46 }).collect() }
    }
    fn funded() -> State {
        let mut s = State::default();
        s.balances.insert(Venue::Kalshi, 100.); s.balances.insert(Venue::Polymarket, 100.);
        s
    }

    #[test]
    fn guard_codes() {
        let (c, a) = (cfg(Mode::Paper), arb("x", &[Venue::Kalshi, Venue::Polymarket]));
        assert_eq!(guard(&c, &funded(), &a, 1000), Ok(()));
        let mut s = funded(); s.halted = Some("x".into());
        assert_eq!(guard(&c, &s, &a, 1000), Err("PM_HALTED"));
        assert_eq!(guard(&cfg(Mode::Live), &funded(), &a, 1000), Err("POLY_LIVE_UNSUPPORTED"));
        assert_eq!(guard(&cfg(Mode::Live), &funded(), &arb("k", &[Venue::Kalshi, Venue::Kalshi]), 1000), Ok(()));
        let mut s = funded(); s.last_trade.insert("x".into(), 990);
        assert_eq!(guard(&c, &s, &a, 1000), Err("COOLDOWN"));
        let mut s = funded(); s.trades.extend([500, 900]);
        assert_eq!(guard(&c, &s, &a, 1000), Err("RATE_LIMIT"));
        let mut s = funded(); s.positions.push(Position { id: "p".into(), arb: arb("old", &[Venue::Kalshi]), opened: 0, mode: "paper".into() });
        s.positions.push(Position { id: "q".into(), arb: arb("old2", &[Venue::Kalshi]), opened: 0, mode: "paper".into() });
        assert_eq!(guard(&c, &s, &a, 1000), Err("PM_EXPOSURE_CAP"));
        let mut s = funded(); s.balances.insert(Venue::Polymarket, 5.);
        assert_eq!(guard(&c, &s, &a, 1000), Err("NO_CASH"));
    }

    #[test]
    fn fill_moves_cash_and_locks_profit() {
        let mut s = funded();
        let f = Fees { kalshi_rate: 0.07, poly_bps: 0. };
        let a = arb("x", &[Venue::Kalshi, Venue::Polymarket]);
        book_fill(&mut s, &a, &f, "paper");
        assert_eq!(s.positions.len(), 1);
        assert!((s.balances[&Venue::Polymarket] - (100. - 40. * 0.46)).abs() < 1e-9);
        assert!(s.balances[&Venue::Kalshi] < 100. - 40. * 0.46);       // Kalshi leg also paid its fee
        assert_eq!(s.locked, 2.5);
    }
}
