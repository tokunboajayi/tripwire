use crate::auth::{err, user_from_token, who, writer};
use crate::config::env_or;
use crate::ledger::{close_pos, Account, SLIP};
use crate::replay::{self, load_stocks};
use crate::risk::{agent_limits, set_limits, Limits, Status, MAX_RAISE_STEP, PROFILES};
use super::internal;
use crate::state::{Ev, Replay, World};
use crate::{now, ok, R, S};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct NewAcct { profile: String, goal_amount: Option<f64>, goal_months: Option<f64>, start_cash: Option<f64> }

/// Onboarding: `{profile, goal_amount, goal_months, start_cash}`. One account per user.
pub async fn create(State(app): State<S>, h: HeaderMap, Json(b): Json<NewAcct>) -> R {
    let u = writer(&app, &h).await?;
    if !PROFILES.contains(&b.profile.as_str()) { return Err(err(StatusCode::BAD_REQUEST, "profile")) }
    let cash = b.start_cash.unwrap_or(10_000.).clamp(100., 1_000_000.);
    let goal = b.goal_amount.unwrap_or(cash * 0.1).clamp(1., 10_000_000.);
    let months = b.goal_months.unwrap_or(12.).clamp(1., 120.);
    {
        let mut w = app.w.lock().unwrap();
        let a = Account::new(&u, &b.profile, cash, goal, months, &app.cfg.symbols, now());
        w.accounts.insert(u.clone(), a);
        w.emit(Some(&u), "account", format!("Account funded with ${cash:.0} (paper). Profile: {}. Goal: +${goal:.0} in {months:.0} months.", b.profile), json!({}));
    }
    me(State(app), h).await
}

fn avg(it: impl Iterator<Item = f64>) -> f64 {
    let v: Vec<f64> = it.collect();
    if v.is_empty() { 0. } else { v.iter().sum::<f64>() / v.len() as f64 }
}

fn positions_json(w: &World, a: &Account) -> Vec<Value> {
    let px = w.prices();
    a.sleeves.iter().filter_map(|(s, sl)| sl.pos.as_ref().map(|p| {
        let price = px.get(s).copied().unwrap_or(p.entry);
        json!({"symbol": s, "qty": p.qty, "entry": p.entry, "price": price, "value": p.qty * price, "pnl": p.qty * price - p.cost,
            "brain": p.brain, "brain_label": p.brain.label(), "regime": p.regime, "stop": p.stop, "opened": p.opened, "thesis": p.thesis})
    })).collect()
}

/// Account, limits, equity, goal progress.
pub fn summary(w: &World, a: &Account, owner: bool) -> Value {
    let px = w.prices();
    let eq = a.equity(&px);
    let pnl = eq - a.start_cash;
    let n = a.trades.len();
    let wins = a.trades.iter().filter(|t| t.pnl > 0.).count();
    let aw = avg(a.trades.iter().filter(|t| t.pnl > 0.).map(|t| t.ret));
    let al = -avg(a.trades.iter().filter(|t| t.pnl <= 0.).map(|t| t.ret));
    json!({"user": a.user, "profile": a.profile, "status": a.status, "limits": a.limits, "start_cash": a.start_cash, "equity": eq,
        "pnl_total": pnl, "pnl_today": eq - a.day_start_equity, "exposure": a.exposure(&px),
        "goal": {"amount": a.goal_amount, "months": a.goal_months, "progress": (pnl / a.goal_amount).max(0.), "created": a.created},
        "cash": a.sleeves.values().map(|s| s.cash).sum::<f64>(), "digest": a.digest, "kill_switch": w.kill,
        "stats": {"trades": n, "win_rate": if n > 0 { wins as f64 / n as f64 } else { 0. },
            "breakeven_win_rate": if aw + al > 0. { al / (aw + al) } else { 0. }},
        "positions": positions_json(w, a),
        "mcp_token": if owner { Some(a.mcp_token.clone()) } else { None }})
}

pub async fn me(State(app): State<S>, h: HeaderMap) -> R {
    let (u, ro) = who(&app, &h).await?;
    let w = app.w.lock().unwrap();
    match w.accounts.get(&u) { Some(a) => ok(summary(&w, a, !ro)), None => Err(err(StatusCode::NOT_FOUND, "no account")) }
}

#[derive(Deserialize)]
pub struct Prof { profile: String }

/// Risk slider. Users can pick any profile up to aggressive.
pub async fn set_profile(State(app): State<S>, h: HeaderMap, Json(b): Json<Prof>) -> R {
    let u = writer(&app, &h).await?;
    if !PROFILES.contains(&b.profile.as_str()) { return Err(err(StatusCode::BAD_REQUEST, "profile")) }
    let mut w = app.w.lock().unwrap();
    let a = w.accounts.get_mut(&u).ok_or(err(StatusCode::NOT_FOUND, "no account"))?;
    a.limits = set_limits(&a.limits, &Limits::profile(&b.profile), false).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    a.profile = b.profile.clone();
    let lim = a.limits;
    w.emit(Some(&u), "limits", format!("Risk profile set to {}: risk {:.0}%/trade, max position {:.0}%, daily loss stop {:.0}%.",
        b.profile, lim.risk * 100., lim.maxpos * 100., lim.daily_loss * 100.), json!({"limits": lim, "profile": b.profile}));
    ok(json!({"limits": lim}))
}

pub async fn positions(State(app): State<S>, h: HeaderMap) -> R {
    let (u, _) = who(&app, &h).await?;
    let w = app.w.lock().unwrap();
    let a = w.accounts.get(&u).ok_or(err(StatusCode::NOT_FOUND, "no account"))?;
    ok(json!(positions_json(&w, a)))
}

pub async fn trades(State(app): State<S>, h: HeaderMap) -> R {
    let (u, _) = who(&app, &h).await?;
    let w = app.w.lock().unwrap();
    ok(json!(w.accounts.get(&u).map(|a| &a.trades)))
}

#[derive(Deserialize)]
pub struct Range { range: Option<String> }

/// Equity curve. `range` = 1d | 1w | 1m | all (default).
pub async fn equity(State(app): State<S>, h: HeaderMap, Query(q): Query<Range>) -> R {
    let (u, _) = who(&app, &h).await?;
    let w = app.w.lock().unwrap();
    let a = w.accounts.get(&u).ok_or(err(StatusCode::NOT_FOUND, "no account"))?;
    let span = match q.range.as_deref() { Some("1d") => 86_400, Some("1w") => 7 * 86_400, Some("1m") => 30 * 86_400, _ => i64::MAX };
    let from = now().saturating_sub(span);
    let mut pts: Vec<(i64, f64)> = a.equity.iter().copied().filter(|(t, _)| *t >= from).collect();
    pts.push((now(), a.equity(&w.prices())));
    ok(json!(pts))
}

#[derive(Deserialize)]
pub struct Limit { limit: Option<usize> }

/// Why-log: global + own events, newest first.
pub async fn events(State(app): State<S>, h: HeaderMap, Query(q): Query<Limit>) -> R {
    let (u, _) = who(&app, &h).await?;
    let w = app.w.lock().unwrap();
    let mut v: Vec<&Ev> = w.events.iter().chain(w.accounts.get(&u).map(|a| a.events.iter()).into_iter().flatten()).collect();
    v.sort_by_key(|e| e.id);
    ok(json!(v.into_iter().rev().take(q.limit.unwrap_or(200).min(500)).collect::<Vec<_>>()))
}

/// pause · resume · kill · flatten · agent-loosen (demo)
pub async fn action(State(app): State<S>, h: HeaderMap, Path(action): Path<String>) -> R {
    let u = writer(&app, &h).await?;
    let mut w = app.w.lock().unwrap();
    let px = w.prices();
    let a = w.accounts.get_mut(&u).ok_or(err(StatusCode::NOT_FOUND, "no account"))?;
    let mut evs: Vec<(&str, String, Value)> = vec![];
    let mut mirror: Vec<(String, f64)> = vec![];
    match action.as_str() {
        "pause" => { a.status = Status::Paused; evs.push(("status", "Paused. Open positions keep their stops.".into(), json!({}))) }
        "resume" => { a.status = Status::Active; evs.push(("status", "Resumed.".into(), json!({}))) }
        "kill" => { a.status = Status::Killed; evs.push(("status", "Kill switch on: no new orders. Positions are held until you flatten.".into(), json!({}))) }
        "flatten" => {
            let t = now();
            for (s, sl) in a.sleeves.iter_mut() {
                let Some(q) = sl.pos.as_ref().map(|p| p.qty) else { continue };
                mirror.push((s.clone(), q));
                let price = px.get(s).copied().unwrap_or(sl.pos.as_ref().unwrap().entry);
                let (m, d) = close_pos(s, sl, price * (1. - SLIP), "flatten", t, &mut a.trades);
                evs.push(("order", m, d));
            }
        }
        "agent-loosen" => {
            // The AI asks for one +25% step of risk. Rust decides: never above your ceiling, only when its record earns it.
            let (cur, ceiling, rec) = (a.limits, Limits::profile(&a.profile), a.record(&px, now()));
            let mut req = cur;
            req.risk = (cur.risk * (1. + MAX_RAISE_STEP)).min(ceiling.risk);
            if req.risk <= cur.risk + 1e-12 { req.risk = cur.risk * (1. + MAX_RAISE_STEP) } // already at the ceiling: ask anyway, Rust refuses
            let t0 = std::time::Instant::now();
            let r = agent_limits(&cur, &req, &ceiling, &rec);
            let ns = t0.elapsed().as_nanos() as u64;
            match r {
                Ok(l) => { a.limits = l; evs.push(("limits", internal::earned_msg(&cur, &l, &ceiling, &rec), json!({"limits": l, "latency_ns": ns}))) }
                Err(code) => evs.push(("gate_block", internal::block_msg(code, &cur, &ceiling, &rec), json!({"code": code, "latency_ns": ns}))),
            }
        }
        _ => return Err(err(StatusCode::NOT_FOUND, "action")),
    }
    for (s, q) in mirror { w.queue_mirror(&u, &s, "sell", q); }
    for (k, m, d) in evs { w.emit(Some(&u), k, m, d); }
    ok(json!({"ok": true}))
}

/// Global kill switch. Owner-only whenever OWNER_USER is set (also in DEV, so visitors can't kill a public demo).
pub async fn kill_all(State(app): State<S>, h: HeaderMap) -> R {
    let u = writer(&app, &h).await?;
    let allowed = match app.cfg.owner.as_deref() { Some(o) => o == u.as_str(), None => app.cfg.dev };
    if !allowed { return Err(err(StatusCode::FORBIDDEN, "owner only")) }
    let mut w = app.w.lock().unwrap();
    w.kill = !w.kill;
    let k = w.kill;
    w.emit(None, "kill", if k { "GLOBAL KILL SWITCH ON: all new orders blocked.".into() } else { "Global kill switch off.".into() }, json!({"on": k}));
    ok(json!({"kill": k}))
}

#[derive(Deserialize)]
pub struct ReplayReq { speed: Option<f64>, from: Option<String>, dataset: Option<String> }

/// Start a replay `{dataset: crypto|stocks, speed, from}`. One per user at a time.
pub async fn start_replay(State(app): State<S>, h: HeaderMap, Json(b): Json<ReplayReq>) -> R {
    let u = writer(&app, &h).await?;
    let from = chrono::NaiveDate::parse_from_str(b.from.as_deref().unwrap_or("2025-01-01"), "%Y-%m-%d")
        .map_err(|_| err(StatusCode::BAD_REQUEST, "from"))?.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
    let speed = b.speed.unwrap_or(20.).clamp(1., 200.);
    let (lim, data, gen) = {
        let mut w = app.w.lock().unwrap();
        if replay::running(w.replays.get(&u)) { return Err(err(StatusCode::CONFLICT, "replay running")) }
        let lim = w.accounts.get(&u).map(|a| a.limits).unwrap_or(Limits::profile("balanced"));
        let data = if b.dataset.as_deref() == Some("stocks") {
            load_stocks(&app.cfg.data_dir).ok_or(err(StatusCode::NOT_FOUND, "no stock data: run data/fetch_stocks.py"))?
        } else {
            w.markets.iter().map(|(s, m)| (s.clone(), m.candles.clone(), m.inds.clone())).collect()
        };
        let gen = w.replays.get(&u).map_or(0, |r| r.gen) + 1;
        w.replays.insert(u.clone(), Replay { status: "running".into(), gen, ..Default::default() });
        (lim, data, gen)
    };
    replay::spawn(app.clone(), u, data, lim, from, speed, gen);
    ok(json!({"status": "running", "speed": speed, "gen": gen}))
}

/// Stop the caller's running replay (the loop exits on its next day).
pub async fn stop_replay(State(app): State<S>, h: HeaderMap) -> R {
    let u = writer(&app, &h).await?;
    let mut w = app.w.lock().unwrap();
    let r = w.replays.get_mut(&u).filter(|r| r.status == "running").ok_or(err(StatusCode::NOT_FOUND, "no running replay"))?;
    r.status = "stopped".into();
    let gen = r.gen;
    w.emit(Some(&format!("replay:{u}")), "replay_done", "Replay stopped.".into(), json!({"stopped": true, "gen": gen}));
    ok(json!({"status": "stopped"}))
}

pub async fn get_replay(State(app): State<S>, h: HeaderMap) -> R {
    let (u, _) = who(&app, &h).await?;
    let w = app.w.lock().unwrap();
    ok(json!(w.replays.get(&u)))
}

#[derive(Deserialize)]
pub struct VoiceQ { text: String, token: String }

/// ElevenLabs text-to-speech proxy so the key never reaches the browser.
pub async fn voice(State(app): State<S>, Query(q): Query<VoiceQ>) -> R {
    user_from_token(&app, &q.token).await.ok_or(err(StatusCode::UNAUTHORIZED, "token"))?;
    let key = std::env::var("ELEVENLABS_API_KEY").ok().filter(|k| !k.is_empty()).ok_or(err(StatusCode::NOT_FOUND, "voice off"))?;
    let vid = env_or("ELEVENLABS_VOICE", "21m00Tcm4TlvDq8ikWAM");
    let model = env_or("ELEVENLABS_MODEL", "eleven_flash_v2_5");
    let r = app.http.post(format!("{}/v1/text-to-speech/{vid}", app.cfg.elevenlabs_url))
        .header("xi-api-key", key.trim()).header("accept", "audio/mpeg")
        .json(&json!({"text": speech_text(&q.text), "model_id": model}))
        .send().await.map_err(|e| { eprintln!("voice: ElevenLabs unreachable: {e}"); err(StatusCode::BAD_GATEWAY, "ElevenLabs unreachable") })?;
    let status = r.status();
    if !status.is_success() {
        // Surface ElevenLabs' own reason (bad key, quota, blocked IP, unknown voice) instead of a bare 502.
        let body: Value = r.json().await.unwrap_or(Value::Null);
        let d = &body["detail"];
        let why = d["message"].as_str().or(d.as_str()).unwrap_or("no detail");
        let code = d["status"].as_str().unwrap_or("");
        let msg = format!("ElevenLabs {}{}: {why}", status.as_u16(), if code.is_empty() { String::new() } else { format!(" {code}") });
        eprintln!("voice: {msg}");
        return Err(err(StatusCode::BAD_GATEWAY, &msg));
    }
    let bytes = r.bytes().await.map_err(|e| err(StatusCode::BAD_GATEWAY, &e.to_string()))?;
    Ok(([(axum::http::header::CONTENT_TYPE, "audio/mpeg")], bytes).into_response())
}

/// Up to 600 chars (bounds ElevenLabs credit use), cut at the last sentence end so speech never stops mid-word.
fn speech_text(t: &str) -> String {
    const CAP: usize = 600;
    let t = t.trim();
    if t.chars().count() <= CAP { return t.to_string() }
    let head: String = t.chars().take(CAP).collect();
    match head.rfind(|c| matches!(c, '.' | '!' | '?')) {
        Some(i) if i > CAP / 3 => head[..=i].to_string(),
        _ => head,
    }
}
