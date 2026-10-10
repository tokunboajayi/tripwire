//! Tripwire engine: HTTP API + SSE + live loop + replay. See docs/03_BUILD_SPEC.md.
mod engine;
use axum::{extract::{Path, Query, State}, http::{HeaderMap, StatusCode}, response::{sse::{Event as SseEvent, KeepAlive, Sse}, IntoResponse, Response},
    routing::{get, patch, post}, Json, Router};
use engine::*;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::{BTreeMap, HashMap, VecDeque}, sync::{Arc, Mutex}, time::Duration};
use tokio::sync::{broadcast, OnceCell};

struct Cfg { symbols: Vec<String>, dev: bool, internal_token: String, auth0_domain: Option<String>, auth0_aud: String, data_dir: String, owner: Option<String>, market_url: String, web_dir: String, port: u16 }
struct App { cfg: Cfg, w: Mutex<World>, http: reqwest::Client, jwks: OnceCell<jsonwebtoken::jwk::JwkSet> }
type S = Arc<App>;
type R = Result<Response, (StatusCode, String)>;
fn env(k: &str, d: &str) -> String { std::env::var(k).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| d.into()) }
fn now() -> i64 { chrono::Utc::now().timestamp() }
fn err(c: StatusCode, m: &str) -> (StatusCode, String) { (c, m.into()) }
fn ok(v: Value) -> R { Ok(Json(v).into_response()) }

#[tokio::main]
async fn main() {
    // Load .env from the repo root (or current dir). Real environment variables win.
    let _ = dotenvy::from_filename("../.env").or_else(|_| dotenvy::dotenv());
    let cfg = Cfg {
        symbols: env("SYMBOLS", "BTC,ETH,SOL").split(',').map(|s| s.trim().split('/').next().unwrap().to_uppercase()).collect(),
        dev: env("DEV", "0") == "1", internal_token: env("INTERNAL_TOKEN", "change-me"),
        auth0_domain: std::env::var("AUTH0_DOMAIN").ok().filter(|s| !s.is_empty()), auth0_aud: env("AUTH0_AUDIENCE", ""),
        data_dir: env("DATA_DIR", "./data"), owner: std::env::var("OWNER_USER").ok(), market_url: env("MARKET_URL", "https://data-api.binance.vision"),
        web_dir: env("WEB_DIR", "../web/dist"), port: env("PORT", "8080").parse().unwrap_or(8080),
    };
    let (tx, _) = broadcast::channel(1024);
    let saved_audit: (Vec<Audit>, Vec<Anchor>) = std::fs::read_to_string(format!("{}/audit.json", cfg.data_dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let accounts: HashMap<String, Account> = std::fs::read_to_string(format!("{}/state.json", cfg.data_dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let app: S = Arc::new(App { w: Mutex::new(World { markets: BTreeMap::new(), accounts, replays: HashMap::new(), kill: false, events: VecDeque::new(), next_id: 0, tx, mirror_user: std::env::var("MIRROR_USER").ok().filter(|s| !s.is_empty()), mirror_queue: vec![], audit: saved_audit.0, anchors: saved_audit.1 }),
        http: reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap(), jwks: OnceCell::new(), cfg });
    for s in app.cfg.symbols.clone() {
        match klines(&app, &s, Some(1622505600000)).await {
            Ok(cs) if cs.len() > 300 => {
                let inds = compute(&cs); let n = cs.len(); let r = inds.row(n - 1); let reg = regime(cs[n - 1].c, &r);
                app.w.lock().unwrap().markets.insert(s.clone(), Market { price: cs[n - 1].c, updated: now(), candles: cs, inds, det: reg, fin: reg, source: "fallback".into(), conf: 1., ai: None });
                println!("loaded {s}: {n} daily candles, regime {reg:?}");
            }
            e => eprintln!("market load failed for {s}: {:?}", e.map(|c| c.len())),
        }
    }
    let a2 = app.clone();
    tokio::spawn(async move { loop { live_tick(&a2).await; tokio::time::sleep(Duration::from_secs(60)).await; } });
    let cors = tower_http::cors::CorsLayer::very_permissive();
    let web = tower_http::services::ServeDir::new(&app.cfg.web_dir).fallback(tower_http::services::ServeFile::new(format!("{}/index.html", app.cfg.web_dir)));
    let api = Router::new()
        .route("/v1/health", get(|| async { Json(json!({"ok": true})) }))
        .route("/v1/market/regimes", get(regimes)).route("/v1/market/:sym/candles", get(candles)).route("/v1/backtest", get(backtest))
        .route("/v1/accounts", post(create_account)).route("/v1/accounts/me", get(me))
        .route("/v1/accounts/me/profile", patch(set_profile)).route("/v1/accounts/me/:action", post(account_action))
        .route("/v1/accounts/me/trades", get(trades)).route("/v1/accounts/me/equity", get(equity)).route("/v1/accounts/me/events", get(events))
        .route("/v1/stream", get(stream)).route("/v1/replays", post(start_replay)).route("/v1/replays/me", get(get_replay))
        .route("/v1/admin/kill-all", post(kill_all)).route("/v1/config", get(config)).route("/v1/audit", get(audit_list)).route("/v1/audit/status", get(audit_status))
        .route("/internal/audit/head", get(i_audit_head)).route("/internal/audit/anchor", post(i_audit_anchor)).route("/v1/voice", get(voice))
        .route("/internal/snapshot", get(i_snapshot)).route("/internal/regime", post(i_regime)).route("/internal/positions", get(i_positions))
        .route("/internal/thesis", post(i_thesis)).route("/internal/exit", post(i_exit)).route("/internal/stream", post(i_stream))
        .route("/internal/accounts", get(i_accounts)).route("/internal/digest", post(i_digest)).route("/internal/limits", post(i_limits))
        .with_state(app.clone()).layer(cors).fallback_service(web);
    let l = tokio::net::TcpListener::bind(("0.0.0.0", app.cfg.port)).await.unwrap();
    println!("tripwire engine on :{}", app.cfg.port);
    axum::serve(l, api).await.unwrap();
}

async fn klines(app: &App, sym: &str, start: Option<i64>) -> Result<Vec<Candle>, String> {
    let mut out: Vec<Candle> = vec![]; let mut t = start;
    loop {
        let mut url = format!("{}/api/v3/klines?symbol={sym}USDT&interval=1d&limit={}", app.cfg.market_url, if t.is_some() { 1000 } else { 3 });
        if let Some(s) = t { url += &format!("&startTime={s}"); }
        let rows: Vec<Vec<Value>> = app.http.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        let f = |v: &Value| v.as_str().and_then(|s| s.parse().ok()).unwrap_or(f64::NAN);
        let got = rows.len();
        out.extend(rows.iter().map(|r| Candle { t: r[0].as_i64().unwrap_or(0) / 1000, o: f(&r[1]), h: f(&r[2]), l: f(&r[3]), c: f(&r[4]), v: f(&r[5]) }));
        match t { Some(_) if got == 1000 => t = Some(out.last().unwrap().t * 1000 + 1), _ => break }
    }
    Ok(out)
}

async fn live_tick(app: &S) {
    for s in app.cfg.symbols.clone() {
        if let Ok(latest) = klines(app, &s, None).await {
            let mut w = app.w.lock().unwrap();
            if let Some(m) = w.markets.get_mut(&s) {
                for k in latest { match m.candles.iter().position(|c| c.t == k.t) { Some(i) => m.candles[i] = k, None if k.t > m.candles.last().map_or(0, |c| c.t) => m.candles.push(k), _ => {} } }
                m.price = m.candles.last().unwrap().c; m.updated = now();
            }
        }
    }
    let (snapshot, audit, mirror) = { let mut w = app.w.lock().unwrap(); w.tick(now());
        (serde_json::to_string(&w.accounts).ok(), serde_json::to_string(&(&w.audit, &w.anchors)).ok(), std::mem::take(&mut w.mirror_queue)) };
    if let Some(a) = audit { let _ = std::fs::create_dir_all(&app.cfg.data_dir); let _ = std::fs::write(format!("{}/audit.json", app.cfg.data_dir), a); }
    for (sym, side, qty) in mirror { mirror_order(app, &sym, &side, qty).await; }
    if let Some(s) = snapshot { let _ = std::fs::create_dir_all(&app.cfg.data_dir); let _ = std::fs::write(format!("{}/state.json", app.cfg.data_dir), s); }
}

/// Mirror an order to the owner's Alpaca paper account (real broker paper fills). Ledger stays simulated.
async fn mirror_order(app: &S, sym: &str, side: &str, qty: f64) {
    let (Ok(k), Ok(sec)) = (std::env::var("APCA_API_KEY_ID"), std::env::var("APCA_API_SECRET_KEY")) else { return };
    let url = format!("{}/v2/orders", env("APCA_PAPER_URL", "https://paper-api.alpaca.markets"));
    let body = json!({"symbol": format!("{sym}/USD"), "qty": format!("{qty:.6}"), "side": side, "type": "market", "time_in_force": "gtc",
        "client_order_id": format!("tw-{}", uuid::Uuid::new_v4().simple())});
    let res = app.http.post(url).header("APCA-API-KEY-ID", k).header("APCA-API-SECRET-KEY", sec).json(&body).send().await;
    let (msg, ok) = match res {
        Ok(r) if r.status().is_success() => { let v: Value = r.json().await.unwrap_or_default(); (format!("Mirrored to Alpaca paper: {side} {qty:.4} {sym} (order {}, status {}).", v["id"].as_str().unwrap_or("?"), v["status"].as_str().unwrap_or("?")), true) }
        Ok(r) => { let st = r.status(); (format!("Alpaca paper mirror rejected {side} {sym}: HTTP {st} {}", r.text().await.unwrap_or_default().chars().take(120).collect::<String>()), false) }
        Err(e) => (format!("Alpaca paper mirror failed: {e}"), false),
    };
    let mut w = app.w.lock().unwrap(); let u = w.mirror_user.clone();
    w.emit(u.as_deref(), "mirror", msg, json!({"ok": ok, "symbol": sym, "side": side}));
}

// ---------- auth ----------
#[derive(Deserialize)] struct Claims { sub: String }
async fn verify_jwt(app: &App, token: &str) -> Option<String> {
    use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
    let dom = app.cfg.auth0_domain.clone()?;
    let jwks = app.jwks.get_or_try_init(|| async { app.http.get(format!("https://{dom}/.well-known/jwks.json")).send().await?.json().await }).await.ok()?;
    let jwk = jwks.find(&decode_header(token).ok()?.kid?)?;
    let mut v = Validation::new(Algorithm::RS256); v.set_audience(&[&app.cfg.auth0_aud]); v.set_issuer(&[format!("https://{dom}/")]);
    decode::<Claims>(token, &DecodingKey::from_jwk(jwk).ok()?, &v).ok().map(|d| d.claims.sub)
}
async fn user_from_token(app: &App, t: &str) -> Option<String> {
    if app.cfg.dev { if let Some(u) = t.strip_prefix("dev:") { return Some(format!("dev|{u}")) } }
    verify_jwt(app, t).await
}
/// Returns (user, read_only). MCP tokens are read-only.
async fn who(app: &App, h: &HeaderMap) -> Result<(String, bool), (StatusCode, String)> {
    let hv = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).map(String::from);
    if let Some(t) = hv("x-mcp-token") {
        return app.w.lock().unwrap().accounts.values().find(|a| a.mcp_token == t).map(|a| (a.user.clone(), true)).ok_or(err(StatusCode::UNAUTHORIZED, "bad mcp token"));
    }
    if let Some(b) = hv("authorization") { if let Some(t) = b.strip_prefix("Bearer ") { return user_from_token(app, t).await.map(|u| (u, false)).ok_or(err(StatusCode::UNAUTHORIZED, "bad token")) } }
    if app.cfg.dev { if let Some(u) = hv("x-dev-user") { return Ok((format!("dev|{u}"), false)) } }
    Err(err(StatusCode::UNAUTHORIZED, "sign in"))
}
async fn writer(app: &App, h: &HeaderMap) -> Result<String, (StatusCode, String)> {
    let (u, ro) = who(app, h).await?; if ro { Err(err(StatusCode::FORBIDDEN, "read-only token")) } else { Ok(u) }
}
fn internal(app: &App, h: &HeaderMap) -> Result<(), (StatusCode, String)> {
    if h.get("x-internal-token").and_then(|v| v.to_str().ok()) == Some(app.cfg.internal_token.as_str()) { Ok(()) } else { Err(err(StatusCode::UNAUTHORIZED, "internal")) }
}

// ---------- public ----------
async fn regimes(State(app): State<S>) -> R {
    let w = app.w.lock().unwrap();
    ok(json!(w.markets.iter().map(|(s, m)| { let r = m.inds.row(m.candles.len() - 1);
        json!({"symbol": s, "price": m.price, "regime": m.fin, "brain": m.fin.brain(), "brain_label": m.fin.brain().label(), "regime_label": m.fin.label(),
            "deterministic": m.det, "source": m.source, "confidence": m.conf, "ai_reason": m.ai.as_ref().map(|a| a.2.clone()),
            "indicators": {"rsi2": r.rsi2, "adx": r.adx, "atrp_rank": r.atrp_rank, "ema50": r.ema50, "ema200": r.ema200, "sma200": r.sma200}, "updated": m.updated}) }).collect::<Vec<_>>()))
}
#[derive(Deserialize)] struct Days { days: Option<usize> }
async fn candles(State(app): State<S>, Path(sym): Path<String>, Query(q): Query<Days>) -> R {
    let w = app.w.lock().unwrap(); let m = w.markets.get(&sym.to_uppercase()).ok_or(err(StatusCode::NOT_FOUND, "symbol"))?;
    let n = m.candles.len(); let from = n.saturating_sub(q.days.unwrap_or(365));
    ok(json!((from..n).map(|i| { let c = m.candles[i]; let r = m.inds.row(i);
        json!({"t": c.t, "o": c.o, "h": c.h, "l": c.l, "c": c.c, "v": c.v, "regime": if r.ready() { Some(regime(c.c, &r)) } else { None }}) }).collect::<Vec<_>>()))
}
async fn backtest(State(app): State<S>) -> R {
    let p = format!("{}/backtest.json", app.cfg.data_dir);
    let v: Value = std::fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str(&s).ok()).ok_or(err(StatusCode::NOT_FOUND, "run backtest/export_json.py"))?;
    ok(v)
}

// ---------- accounts ----------
#[derive(Deserialize)] struct NewAcct { profile: String, goal_amount: Option<f64>, goal_months: Option<f64>, start_cash: Option<f64> }
async fn create_account(State(app): State<S>, h: HeaderMap, Json(b): Json<NewAcct>) -> R {
    let u = writer(&app, &h).await?;
    if !["conservative", "balanced", "aggressive"].contains(&b.profile.as_str()) { return Err(err(StatusCode::BAD_REQUEST, "profile")) }
    let cash = b.start_cash.unwrap_or(10_000.).clamp(100., 1_000_000.);
    {
        let mut w = app.w.lock().unwrap();
        let a = Account::new(&u, &b.profile, cash, b.goal_amount.unwrap_or(cash * 0.1), b.goal_months.unwrap_or(12.), &app.cfg.symbols, now());
        w.accounts.insert(u.clone(), a);
        w.emit(Some(&u), "account", format!("Account funded with ${cash:.0} (paper). Profile: {}.", b.profile), json!({}));
    }
    me(State(app), h).await
}
fn summary(w: &World, a: &Account, owner: bool) -> Value {
    let px = w.prices(); let eq = a.equity(&px); let pnl = eq - a.start_cash;
    let wins = a.trades.iter().filter(|t| t.pnl > 0.).count(); let n = a.trades.len();
    let (aw, al) = (avg(a.trades.iter().filter(|t| t.pnl > 0.).map(|t| t.ret)), -avg(a.trades.iter().filter(|t| t.pnl <= 0.).map(|t| t.ret)));
    json!({"user": a.user, "profile": a.profile, "status": a.status, "limits": a.limits, "start_cash": a.start_cash, "equity": eq, "pnl_total": pnl,
        "pnl_today": eq - a.day_start_equity, "goal": {"amount": a.goal_amount, "months": a.goal_months, "progress": (pnl / a.goal_amount).max(0.)},
        "cash": a.sleeves.values().map(|s| s.cash).sum::<f64>(), "digest": a.digest, "kill_switch": w.kill,
        "stats": {"trades": n, "win_rate": if n > 0 { wins as f64 / n as f64 } else { 0. }, "breakeven_win_rate": if aw + al > 0. { al / (aw + al) } else { 0. }},
        "positions": a.sleeves.iter().filter_map(|(s, sl)| sl.pos.as_ref().map(|p| json!({"symbol": s, "qty": p.qty, "entry": p.entry, "price": px[s],
            "value": p.qty * px[s], "pnl": p.qty * px[s] - p.cost, "brain": p.brain, "brain_label": p.brain.label(), "stop": p.stop, "opened": p.opened, "thesis": p.thesis}))).collect::<Vec<_>>(),
        "mcp_token": if owner { Some(a.mcp_token.clone()) } else { None }})
}
fn avg(it: impl Iterator<Item = f64>) -> f64 { let v: Vec<f64> = it.collect(); if v.is_empty() { 0. } else { v.iter().sum::<f64>() / v.len() as f64 } }
async fn me(State(app): State<S>, h: HeaderMap) -> R {
    let (u, ro) = who(&app, &h).await?; let w = app.w.lock().unwrap();
    match w.accounts.get(&u) { Some(a) => ok(summary(&w, a, !ro)), None => Err(err(StatusCode::NOT_FOUND, "no account")) }
}
#[derive(Deserialize)] struct Prof { profile: String }
async fn set_profile(State(app): State<S>, h: HeaderMap, Json(b): Json<Prof>) -> R {
    let u = writer(&app, &h).await?; let mut w = app.w.lock().unwrap();
    let a = w.accounts.get_mut(&u).ok_or(err(StatusCode::NOT_FOUND, "no account"))?;
    let l = Limits::profile(&b.profile); a.limits = set_limits(&a.limits, &l, false).map_err(|e| err(StatusCode::BAD_REQUEST, e))?; a.profile = b.profile.clone();
    let lim = a.limits;
    w.emit(Some(&u), "limits", format!("Risk profile set to {}: risk {:.0}%/trade, max position {:.0}%, daily loss stop {:.0}%.", b.profile, lim.risk * 100., lim.maxpos * 100., lim.daily_loss * 100.), json!({"limits": lim}));
    ok(json!({"limits": lim}))
}
async fn account_action(State(app): State<S>, h: HeaderMap, Path(action): Path<String>) -> R {
    let u = writer(&app, &h).await?; let mut w = app.w.lock().unwrap(); let px = w.prices();
    let a = w.accounts.get_mut(&u).ok_or(err(StatusCode::NOT_FOUND, "no account"))?;
    let mut evs: Vec<(String, String, Value)> = vec![];
    match action.as_str() {
        "pause" => { a.status = Status::Paused; evs.push(("status".into(), "Paused. Open positions keep their stops.".into(), json!({}))) }
        "resume" => { a.status = Status::Active; evs.push(("status".into(), "Resumed.".into(), json!({}))) }
        "kill" => { a.status = Status::Killed; evs.push(("status".into(), "Kill switch on: no new orders.".into(), json!({}))) }
        "flatten" => { let t = now(); let mut mq = vec![];
            for (s, sl) in a.sleeves.iter_mut() { if let Some(q) = sl.pos.as_ref().map(|p| p.qty) { mq.push((s.clone(), "sell".to_string(), q)); let (m, d) = close_pos(s, sl, px[s] * (1. - SLIP), "flatten", t, &mut a.trades); evs.push(("order".into(), m, d)); } }
            if w.mirror_user.as_deref() == Some(u.as_str()) { w.mirror_queue.extend(mq); } }
        "agent-loosen" => {
            // Demo: an AI agent asks for double risk after a loss. Rust refuses.
            let mut req = a.limits; req.risk *= 2.; req.maxpos = (req.maxpos * 1.5).min(1.);
            let t0 = std::time::Instant::now(); let r = set_limits(&a.limits, &req, true); let ns = t0.elapsed().as_nanos() as u64;
            if let Err(code) = r { evs.push(("gate_block".into(), format!("AI agent asked to double its risk after a loss. Blocked: {code}. Agents can tighten limits, never loosen them."), json!({"code": code, "latency_ns": ns}))) }
        }
        _ => return Err(err(StatusCode::NOT_FOUND, "action")),
    }
    for (k, m, d) in evs { w.emit(Some(&u), &k, m, d); }
    ok(json!({"ok": true}))
}
async fn trades(State(app): State<S>, h: HeaderMap) -> R { let (u, _) = who(&app, &h).await?; let w = app.w.lock().unwrap(); ok(json!(w.accounts.get(&u).map(|a| &a.trades))) }
async fn equity(State(app): State<S>, h: HeaderMap) -> R { let (u, _) = who(&app, &h).await?; let w = app.w.lock().unwrap(); ok(json!(w.accounts.get(&u).map(|a| &a.equity))) }
async fn events(State(app): State<S>, h: HeaderMap) -> R {
    let (u, _) = who(&app, &h).await?; let w = app.w.lock().unwrap();
    let mut v: Vec<&Ev> = w.events.iter().chain(w.accounts.get(&u).map(|a| a.events.iter()).into_iter().flatten()).collect();
    v.sort_by_key(|e| e.id); ok(json!(v.into_iter().rev().take(200).collect::<Vec<_>>()))
}
#[derive(Deserialize)] struct Tok { token: String }
async fn stream(State(app): State<S>, Query(q): Query<Tok>) -> Result<Sse<impl futures::Stream<Item = Result<SseEvent, std::convert::Infallible>>>, (StatusCode, String)> {
    let u = user_from_token(&app, &q.token).await.ok_or(err(StatusCode::UNAUTHORIZED, "token"))?;
    let rx = app.w.lock().unwrap().tx.subscribe(); let rp = format!("replay:{u}");
    let s = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(move |e| {
        let out = match e { Ok(ev) if ev.account.is_none() || ev.account.as_deref() == Some(&u) || ev.account.as_deref() == Some(&rp) =>
            Some(Ok(SseEvent::default().event(ev.kind.clone()).data(serde_json::to_string(&ev).unwrap()))), _ => None };
        async move { out }
    });
    Ok(Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}
async fn kill_all(State(app): State<S>, h: HeaderMap) -> R {
    let u = writer(&app, &h).await?;
    if !app.cfg.dev && app.cfg.owner.as_deref() != Some(u.as_str()) { return Err(err(StatusCode::FORBIDDEN, "owner only")) }
    let mut w = app.w.lock().unwrap(); w.kill = !w.kill; let k = w.kill;
    w.emit(None, "kill", if k { "GLOBAL KILL SWITCH ON: all new orders blocked.".into() } else { "Global kill switch off.".into() }, json!({"on": k}));
    ok(json!({"kill": k}))
}

// ---------- replay: v2 engine over 2025 → today, streamed ----------
#[derive(Deserialize)] struct ReplayReq { speed: Option<f64>, from: Option<String>, dataset: Option<String> }
async fn start_replay(State(app): State<S>, h: HeaderMap, Json(b): Json<ReplayReq>) -> R {
    let u = writer(&app, &h).await?;
    let from = chrono::NaiveDate::parse_from_str(&b.from.unwrap_or("2025-01-01".into()), "%Y-%m-%d").map_err(|_| err(StatusCode::BAD_REQUEST, "from"))?
        .and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
    let (lim, data) = {
        let mut w = app.w.lock().unwrap();
        if w.replays.get(&u).map_or(false, |r| r.status == "running") { return Err(err(StatusCode::CONFLICT, "replay running")) }
        w.replays.insert(u.clone(), Replay { status: "running".into(), ..Default::default() });
        let lim = w.accounts.get(&u).map(|a| a.limits).unwrap_or(Limits::profile("balanced"));
        let data = if b.dataset.as_deref() == Some("stocks") {
            match load_stocks(&app.cfg.data_dir) { Some(d) => d, None => { w.replays.remove(&u); return Err(err(StatusCode::NOT_FOUND, "no stock data: run data/fetch_stocks.py")) } }
        } else { w.markets.iter().map(|(s, m)| (s.clone(), m.candles.clone(), m.inds.clone())).collect::<Vec<_>>() };
        (lim, data)
    };
    let speed = b.speed.unwrap_or(20.).clamp(1., 200.);
    tokio::spawn(async move {
        let rid = format!("replay:{u}"); let per = 10_000. / data.len() as f64;
        let mut sleeves: Vec<Sleeve> = data.iter().map(|_| Sleeve { cash: per, ..Default::default() }).collect();
        let mut trades = vec![];
        let start: Vec<usize> = data.iter().map(|(_, cs, _)| cs.iter().position(|c| c.t >= from).unwrap_or(cs.len())).collect();
        let base: Vec<f64> = data.iter().zip(&start).map(|((_, cs, _), &i)| cs.get(i).map_or(1., |c| c.c)).collect();
        let days = data.iter().zip(&start).map(|((_, cs, _), &i)| cs.len().saturating_sub(i + 2)).min().unwrap_or(0);
        for d in 0..days {
            let mut evs = vec![]; let (mut eq, mut bh) = (0., 0.); let mut t = 0;
            for (k, (s, cs, ind)) in data.iter().enumerate() {
                let i = start[k] + d;
                if let Some(e) = replay_step(s, &mut sleeves[k], cs, ind, i, &lim, &mut trades) { evs.push(e) }
                let c = cs[i + 1]; t = c.t;
                eq += sleeves[k].cash + sleeves[k].pos.as_ref().map_or(0., |p| p.qty * c.c); bh += per * c.c / base[k];
            }
            {
                let mut w = app.w.lock().unwrap();
                if let Some(r) = w.replays.get_mut(&u) { r.equity.push((t, eq)); r.buy_hold.push((t, bh)); r.trades = trades.clone(); }
                for (m, dta) in evs { w.emit(Some(&rid), "replay_order", m, dta); }
                w.emit(Some(&rid), "replay_tick", String::new(), json!({"t": t, "equity": eq, "buy_hold": bh}));
            }
            tokio::time::sleep(Duration::from_secs_f64(1. / speed)).await;
        }
        let mut w = app.w.lock().unwrap();
        if let Some(r) = w.replays.get_mut(&u) { r.status = "done".into(); }
        w.emit(Some(&rid), "replay_done", "Replay finished.".into(), json!({}));
    });
    ok(json!({"status": "running", "speed": speed}))
}
fn load_stocks(dir: &str) -> Option<Vec<(String, Vec<Candle>, Inds)>> {
    let m: BTreeMap<String, Vec<Candle>> = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/stocks.json")).ok()?).ok()?;
    let v: Vec<_> = m.into_iter().filter(|(_, c)| c.len() > 300).map(|(s, c)| { let i = compute_ann(&c, 252.); (s, c, i) }).collect();
    if v.is_empty() { None } else { Some(v) }
}
async fn config(State(app): State<S>) -> R {
    ok(json!({"voice": std::env::var("ELEVENLABS_API_KEY").map_or(false, |k| !k.is_empty()), "stocks": std::path::Path::new(&format!("{}/stocks.json", app.cfg.data_dir)).exists(),
        "mirror": app.w.lock().unwrap().mirror_user.is_some(), "symbols": app.cfg.symbols}))
}
#[derive(Deserialize)] struct VoiceQ { text: String, token: String }
/// ElevenLabs text-to-speech proxy so the key never reaches the browser.
async fn voice(State(app): State<S>, Query(q): Query<VoiceQ>) -> R {
    user_from_token(&app, &q.token).await.ok_or(err(StatusCode::UNAUTHORIZED, "token"))?;
    let key = std::env::var("ELEVENLABS_API_KEY").ok().filter(|k| !k.is_empty()).ok_or(err(StatusCode::NOT_FOUND, "voice off"))?;
    let vid = env("ELEVENLABS_VOICE", "21m00Tcm4TlvDq8ikWAM");
    let r = app.http.post(format!("https://api.elevenlabs.io/v1/text-to-speech/{vid}")).header("xi-api-key", key)
        .json(&json!({"text": q.text.chars().take(240).collect::<String>(), "model_id": "eleven_turbo_v2_5"})).send().await.map_err(|e| err(StatusCode::BAD_GATEWAY, &e.to_string()))?;
    if !r.status().is_success() { return Err(err(StatusCode::BAD_GATEWAY, "elevenlabs")) }
    let bytes = r.bytes().await.map_err(|e| err(StatusCode::BAD_GATEWAY, &e.to_string()))?;
    Ok(([(axum::http::header::CONTENT_TYPE, "audio/mpeg")], bytes).into_response())
}
// ---------- Solana-anchored audit trail ----------
#[derive(Deserialize)] struct Since { since: Option<u64> }
async fn audit_list(State(app): State<S>, Query(q): Query<Since>) -> R {
    let w = app.w.lock().unwrap(); let from = q.since.unwrap_or(0);
    ok(json!({"genesis": GENESIS, "entries": w.audit.iter().filter(|e| e.seq > from).collect::<Vec<_>>(), "anchors": &w.anchors}))
}
async fn audit_status(State(app): State<S>) -> R {
    let w = app.w.lock().unwrap(); let last = w.anchors.last();
    ok(json!({"entries": w.audit.len(), "chain_ok": verify_chain(&w.audit).is_ok(), "head": w.audit.last().map(|e| (e.seq, e.hash.clone())),
        "anchored_seq": last.map(|a| a.seq), "signature": last.map(|a| a.signature.clone()), "cluster": last.map(|a| a.cluster.clone()), "anchored_at": last.map(|a| a.ts),
        "anchors": w.anchors.len()}))
}
async fn i_audit_head(State(app): State<S>, h: HeaderMap) -> R {
    internal(&app, &h)?; let w = app.w.lock().unwrap();
    ok(json!({"seq": w.audit.last().map_or(0, |e| e.seq), "hash": w.audit.last().map(|e| e.hash.clone()), "last_anchored_seq": w.anchors.last().map_or(0, |a| a.seq)}))
}
#[derive(Deserialize)] struct AnchorIn { seq: u64, hash: String, signature: String, cluster: String }
async fn i_audit_anchor(State(app): State<S>, h: HeaderMap, Json(b): Json<AnchorIn>) -> R {
    internal(&app, &h)?; let mut w = app.w.lock().unwrap();
    if !w.audit.iter().any(|e| e.seq == b.seq && e.hash == b.hash) { return Err(err(StatusCode::BAD_REQUEST, "hash does not match chain")) }
    w.anchors.push(Anchor { seq: b.seq, hash: b.hash.clone(), signature: b.signature.clone(), cluster: b.cluster.clone(), ts: now() });
    w.emit(None, "anchor", format!("Audit trail anchored on Solana {}: events 1–{} fingerprint {}… (tx {}…)", b.cluster, b.seq, &b.hash[..12], &b.signature[..12]),
        json!({"seq": b.seq, "signature": b.signature, "cluster": b.cluster}));
    ok(json!({"ok": true}))
}
async fn get_replay(State(app): State<S>, h: HeaderMap) -> R { let (u, _) = who(&app, &h).await?; let w = app.w.lock().unwrap(); ok(json!(w.replays.get(&u))) }

// ---------- internal (agents) ----------
async fn i_snapshot(State(app): State<S>, h: HeaderMap) -> R { internal(&app, &h)?; regimes(State(app)).await }
#[derive(Deserialize)] struct RegCall { symbol: String, regime: Regime, confidence: f64, reason: String }
async fn i_regime(State(app): State<S>, h: HeaderMap, Json(b): Json<RegCall>) -> R {
    internal(&app, &h)?; let mut w = app.w.lock().unwrap();
    let m = w.markets.get_mut(&b.symbol).ok_or(err(StatusCode::NOT_FOUND, "symbol"))?;
    let r = m.inds.row(m.candles.len() - 1); let (fin, src) = accept_ai(b.regime, m.det, m.price, &r);
    m.ai = Some((b.regime, b.confidence.clamp(0., 1.), b.reason.clone(), now()));
    let msg = if src == "ai" { format!("Regime Agent: {} is {} ({:.0}% confident). {}", b.symbol, b.regime.label(), b.confidence * 100., b.reason) }
        else { format!("Regime Agent said {} is {}, but the data disagrees. Rust kept {}: REGIME_MISMATCH.", b.symbol, b.regime.label(), fin.label()) };
    w.emit(None, if src == "ai" { "ai_regime" } else { "gate_block" }, msg, json!({"symbol": b.symbol, "ai": b.regime, "final": fin, "source": src, "code": if src == "ai" { "OK" } else { "REGIME_MISMATCH" }}));
    ok(json!({"final": fin, "source": src}))
}
async fn i_positions(State(app): State<S>, h: HeaderMap) -> R {
    internal(&app, &h)?; let w = app.w.lock().unwrap();
    ok(json!(w.accounts.values().flat_map(|a| a.sleeves.iter().filter_map(move |(s, sl)| sl.pos.as_ref().map(|p|
        json!({"account": a.user, "symbol": s, "brain": p.brain, "regime": p.regime, "entry": p.entry, "opened": p.opened, "thesis": p.thesis}))))
        .collect::<Vec<_>>()))
}
#[derive(Deserialize)] struct ThesisIn { account: String, symbol: String, reason: String, invalidation: Vec<String>, confidence: f64 }
async fn i_thesis(State(app): State<S>, h: HeaderMap, Json(b): Json<ThesisIn>) -> R {
    internal(&app, &h)?; let mut w = app.w.lock().unwrap();
    let p = w.accounts.get_mut(&b.account).and_then(|a| a.sleeves.get_mut(&b.symbol)).and_then(|s| s.pos.as_mut()).ok_or(err(StatusCode::NOT_FOUND, "position"))?;
    p.thesis = Some(Thesis { reason: b.reason.clone(), invalidation: b.invalidation.clone(), confidence: b.confidence });
    w.emit(Some(&b.account), "thesis", format!("Thesis for {}: {} Would prove it wrong: {}.", b.symbol, b.reason, b.invalidation.join("; ")), json!({"symbol": b.symbol}));
    ok(json!({"ok": true}))
}
#[derive(Deserialize)] struct ExitIn { account: String, symbol: String, evidence: String }
async fn i_exit(State(app): State<S>, h: HeaderMap, Json(b): Json<ExitIn>) -> R {
    internal(&app, &h)?; let mut w = app.w.lock().unwrap(); let px = w.prices(); let kill = w.kill;
    let a = w.accounts.get_mut(&b.account).ok_or(err(StatusCode::NOT_FOUND, "account"))?;
    if kill || a.status == Status::Killed { return Err(err(StatusCode::CONFLICT, "KILL_SWITCH")) }
    let sl = a.sleeves.get_mut(&b.symbol).filter(|s| s.pos.is_some()).ok_or(err(StatusCode::NOT_FOUND, "position"))?;
    let q = sl.pos.as_ref().map_or(0., |p| p.qty);
    let (m, d) = close_pos(&b.symbol, sl, px[&b.symbol] * (1. - SLIP), &format!("AI thesis broken: {}", b.evidence), now(), &mut a.trades);
    if w.mirror_user.as_deref() == Some(b.account.as_str()) { w.mirror_queue.push((b.symbol.clone(), "sell".into(), q)); }
    w.emit(Some(&b.account), "order", m, d); ok(json!({"ok": true}))
}
#[derive(Deserialize)] struct StreamIn { symbol: String, text: String }
async fn i_stream(State(app): State<S>, h: HeaderMap, Json(b): Json<StreamIn>) -> R {
    internal(&app, &h)?; let w = app.w.lock().unwrap();
    let _ = w.tx.send(Ev { id: 0, ts: now(), account: None, kind: "reasoning".into(), msg: b.text, data: json!({"symbol": b.symbol}) }); ok(json!({}))
}
async fn i_accounts(State(app): State<S>, h: HeaderMap) -> R {
    internal(&app, &h)?; let w = app.w.lock().unwrap();
    ok(json!(w.accounts.values().map(|a| { let mut s = summary(&w, a, false); s["trades_today"] = json!(a.trades.iter().filter(|t| t.closed / 86400 == now() / 86400).collect::<Vec<_>>()); s }).collect::<Vec<_>>()))
}
#[derive(Deserialize)] struct DigestIn { account: String, text: String }
async fn i_digest(State(app): State<S>, h: HeaderMap, Json(b): Json<DigestIn>) -> R {
    internal(&app, &h)?; let mut w = app.w.lock().unwrap();
    if let Some(a) = w.accounts.get_mut(&b.account) { a.digest = Some(b.text.clone()); }
    w.emit(Some(&b.account), "digest", b.text, json!({})); ok(json!({}))
}
#[derive(Deserialize)] struct LimIn { account: String, limits: Limits }
async fn i_limits(State(app): State<S>, h: HeaderMap, Json(b): Json<LimIn>) -> R {
    internal(&app, &h)?; let mut w = app.w.lock().unwrap();
    let a = w.accounts.get_mut(&b.account).ok_or(err(StatusCode::NOT_FOUND, "account"))?;
    match set_limits(&a.limits, &b.limits, true) {
        Ok(l) => { a.limits = l; w.emit(Some(&b.account), "limits", "AI agent tightened your limits.".into(), json!({"limits": l})); ok(json!({"ok": true})) }
        Err(code) => { w.emit(Some(&b.account), "gate_block", format!("AI agent tried to loosen limits: {code}."), json!({"code": code})); Err(err(StatusCode::FORBIDDEN, code)) }
    }
}
