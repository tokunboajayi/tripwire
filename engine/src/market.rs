//! Market data (spec §4 step 1): daily candles, refreshed every tick.
//! Source: Binance public market-data mirror (no key, US-reachable). Override with MARKET_URL.
//! If the feed is unreachable at boot, falls back to `backtest/fixtures/<SYM>_daily.csv` (OFFLINE_FIXTURES)
//! so the demo never shows an empty screen. Offline prices never refresh, so the risk gate blocks new buys (STALE_PRICE).
use crate::indicators::{compute, Candle};
use crate::regime::regime;
use crate::state::{Ev, Market};
use crate::{now, App, S};
use serde_json::{json, Value};

/// First daily bar we load (2021-06-01), enough history for 200-day averages before 2022.
const HISTORY_START_MS: i64 = 1_622_505_600_000;

/// Daily klines for `{sym}USDT`. `start = None` fetches only the latest 3 bars.
pub async fn klines(app: &App, sym: &str, start: Option<i64>) -> Result<Vec<Candle>, String> {
    let mut out: Vec<Candle> = vec![];
    let mut t = start;
    loop {
        let mut url = format!("{}/api/v3/klines?symbol={sym}USDT&interval=1d&limit={}", app.cfg.market_url, if t.is_some() { 1000 } else { 3 });
        if let Some(s) = t { url += &format!("&startTime={s}"); }
        let rows: Vec<Vec<Value>> = app.http.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        let f = |v: &Value| v.as_str().and_then(|s| s.parse().ok()).unwrap_or(f64::NAN);
        let got = rows.len();
        out.extend(rows.iter().map(|r| Candle { t: r[0].as_i64().unwrap_or(0) / 1000, o: f(&r[1]), h: f(&r[2]), l: f(&r[3]), c: f(&r[4]), v: f(&r[5]) }));
        match t {
            Some(_) if got == 1000 => t = Some(out.last().unwrap().t * 1000 + 1),
            _ => break,
        }
    }
    Ok(out)
}

/// Daily candles from a fixture CSV (columns t,o,h,l,c,v first).
fn load_fixture(dir: &str, sym: &str) -> Option<Vec<Candle>> {
    let txt = std::fs::read_to_string(format!("{dir}/{sym}_daily.csv")).ok()?;
    let cs: Vec<Candle> = txt.lines().skip(1).filter_map(|l| {
        let f: Vec<f64> = l.split(',').take(6).map(|x| x.parse().unwrap_or(f64::NAN)).collect();
        (f.len() == 6).then(|| Candle { t: f[0] as i64, o: f[1], h: f[2], l: f[3], c: f[4], v: f[5] })
    }).collect();
    (cs.len() > 300).then_some(cs)
}

/// Load full history for every configured symbol at boot.
pub async fn load_all(app: &S) {
    for s in app.cfg.symbols.clone() {
        let (cs, feed) = match klines(app, &s, Some(HISTORY_START_MS)).await {
            Ok(cs) if cs.len() > 300 => (cs, "live"),
            e => {
                eprintln!("market load failed for {s}: {:?}", e.map(|c| c.len()));
                match load_fixture(&app.cfg.fixtures_dir, &s) {
                    Some(cs) => (cs, "offline"),
                    None => continue,
                }
            }
        };
        let inds = compute(&cs);
        let n = cs.len();
        let reg = regime(cs[n - 1].c, &inds.row(n - 1));
        // offline: stamp with the last bar's time so the price reads as stale
        let updated = if feed == "live" { now() } else { cs[n - 1].t };
        app.w.lock().unwrap().markets.insert(s.clone(), Market { price: cs[n - 1].c, updated, candles: cs, inds, det: reg, fin: reg,
            source: "fallback".into(), conf: 1., ai: None, feed: feed.into() });
        println!("loaded {s}: {n} daily candles ({feed}), regime {reg:?}");
    }
}

/// Merge the latest bars into each market (today's bar is a rolling daily bar) and stream a `tick`
/// per symbol so charts move live. Ticks go straight to SSE: not stored, not audited.
pub async fn refresh(app: &S) {
    for s in app.cfg.symbols.clone() {
        let Ok(latest) = klines(app, &s, None).await else { continue };
        let mut guard = app.w.lock().unwrap();
        let w = &mut *guard; // split borrows: markets (mut) + tx
        let Some(m) = w.markets.get_mut(&s) else { continue };
        for k in latest {
            match m.candles.iter().position(|c| c.t == k.t) {
                Some(i) => m.candles[i] = k,
                None if k.t > m.candles.last().map_or(0, |c| c.t) => m.candles.push(k),
                _ => {}
            }
        }
        // keep indicators in step with candles: a new daily bar (UTC midnight) must never outrun them
        m.inds = compute(&m.candles);
        let bar = *m.candles.last().unwrap();
        m.price = bar.c;
        m.updated = now();
        m.feed = "live".into();
        let data = json!({"symbol": s, "price": bar.c, "bar": bar, "regime": m.fin, "brain": m.fin.brain()});
        let _ = w.tx.send(Ev { id: 0, ts: m.updated, account: None, kind: "tick".into(), msg: String::new(), data });
    }
}
