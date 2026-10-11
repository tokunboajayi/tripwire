//! Agents → engine. Every handler checks X-Internal-Token.
use super::account::summary;
use super::public::regimes;
use crate::audit::Anchor;
use crate::auth::{err, internal};
use crate::ledger::{close_pos, Thesis, SLIP};
use crate::regime::{accept_ai, Regime};
use crate::risk::{agent_limits, Limits, Record, Status, MAX_RAISE_STEP};
use crate::state::Ev;
use crate::{now, ok, R, S};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

pub async fn snapshot(State(app): State<S>, h: HeaderMap) -> R { internal(&app, &h)?; regimes(State(app)).await }

#[derive(Deserialize)]
pub struct RegCall { symbol: String, regime: Regime, confidence: f64, reason: String }

/// Regime Agent result. Accepted unless REGIME_MISMATCH; the scheduler applies it on the next tick.
pub async fn regime(State(app): State<S>, h: HeaderMap, Json(b): Json<RegCall>) -> R {
    internal(&app, &h)?;
    let mut w = app.w.lock().unwrap();
    let m = w.markets.get_mut(&b.symbol).ok_or(err(StatusCode::NOT_FOUND, "symbol"))?;
    let r = m.inds.row(m.candles.len() - 1);
    let (fin, src) = accept_ai(b.regime, m.det, m.price, &r);
    m.ai = Some((b.regime, b.confidence.clamp(0., 1.), b.reason.clone(), now()));
    let accepted = src == "ai";
    let msg = if accepted { format!("Regime Agent: {} is {} ({:.0}% confident). {}", b.symbol, b.regime.label(), b.confidence * 100., b.reason) }
        else { format!("Regime Agent said {} is {}, but the data disagrees. Rust kept {}: REGIME_MISMATCH.", b.symbol, b.regime.label(), fin.label()) };
    w.emit(None, if accepted { "ai_regime" } else { "gate_block" }, msg,
        json!({"symbol": b.symbol, "ai": b.regime, "final": fin, "source": src, "code": if accepted { "OK" } else { "REGIME_MISMATCH" }}));
    ok(json!({"final": fin, "source": src}))
}

pub async fn positions(State(app): State<S>, h: HeaderMap) -> R {
    internal(&app, &h)?;
    let w = app.w.lock().unwrap();
    ok(json!(w.accounts.values().flat_map(|a| a.sleeves.iter().filter_map(move |(s, sl)| sl.pos.as_ref().map(|p|
        json!({"account": a.user, "symbol": s, "brain": p.brain, "regime": p.regime, "entry": p.entry, "opened": p.opened, "thesis": p.thesis}))))
        .collect::<Vec<_>>()))
}

#[derive(Deserialize)]
pub struct ThesisIn { account: String, symbol: String, reason: String, invalidation: Vec<String>, confidence: f64 }

pub async fn thesis(State(app): State<S>, h: HeaderMap, Json(b): Json<ThesisIn>) -> R {
    internal(&app, &h)?;
    let mut w = app.w.lock().unwrap();
    let p = w.accounts.get_mut(&b.account).and_then(|a| a.sleeves.get_mut(&b.symbol)).and_then(|s| s.pos.as_mut())
        .ok_or(err(StatusCode::NOT_FOUND, "position"))?;
    p.thesis = Some(Thesis { reason: b.reason.clone(), invalidation: b.invalidation.clone(), confidence: b.confidence.clamp(0., 1.) });
    w.emit(Some(&b.account), "thesis", format!("Thesis for {}: {} Would prove it wrong: {}.", b.symbol, b.reason, b.invalidation.join("; ")),
        json!({"symbol": b.symbol}));
    ok(json!({"ok": true}))
}

#[derive(Deserialize)]
pub struct ExitIn { account: String, symbol: String, evidence: String }

/// Thesis Agent says "broken". Exits are always allowed (except under a kill switch).
pub async fn exit(State(app): State<S>, h: HeaderMap, Json(b): Json<ExitIn>) -> R {
    internal(&app, &h)?;
    let mut w = app.w.lock().unwrap();
    let px = w.prices();
    let kill = w.kill;
    let a = w.accounts.get_mut(&b.account).ok_or(err(StatusCode::NOT_FOUND, "account"))?;
    if kill || a.status == Status::Killed { return Err(err(StatusCode::CONFLICT, "KILL_SWITCH")) }
    let sl = a.sleeves.get_mut(&b.symbol).filter(|s| s.pos.is_some()).ok_or(err(StatusCode::NOT_FOUND, "position"))?;
    let q = sl.pos.as_ref().map_or(0., |p| p.qty);
    let price = px.get(&b.symbol).copied().ok_or(err(StatusCode::NOT_FOUND, "price"))?;
    let (m, d) = close_pos(&b.symbol, sl, price * (1. - SLIP), &format!("AI thesis broken: {}", b.evidence), now(), &mut a.trades);
    w.queue_mirror(&b.account, &b.symbol, "sell", q);
    w.emit(Some(&b.account), "order", m, d);
    ok(json!({"ok": true}))
}

#[derive(Deserialize)]
pub struct StreamIn { symbol: String, text: String }

/// Regime Agent reasoning tokens → SSE (not stored).
pub async fn stream(State(app): State<S>, h: HeaderMap, Json(b): Json<StreamIn>) -> R {
    internal(&app, &h)?;
    let w = app.w.lock().unwrap();
    let _ = w.tx.send(Ev { id: 0, ts: now(), account: None, kind: "reasoning".into(), msg: b.text, data: json!({"symbol": b.symbol}) });
    ok(json!({}))
}

pub async fn accounts(State(app): State<S>, h: HeaderMap) -> R {
    internal(&app, &h)?;
    let w = app.w.lock().unwrap();
    let today = now() / 86400;
    ok(json!(w.accounts.values().map(|a| {
        let mut s = summary(&w, a, false);
        s["trades_today"] = json!(a.trades.iter().filter(|t| t.closed / 86400 == today).collect::<Vec<_>>());
        s
    }).collect::<Vec<_>>()))
}

#[derive(Deserialize)]
pub struct DigestIn { account: String, text: String }

pub async fn digest(State(app): State<S>, h: HeaderMap, Json(b): Json<DigestIn>) -> R {
    internal(&app, &h)?;
    let mut w = app.w.lock().unwrap();
    if let Some(a) = w.accounts.get_mut(&b.account) { a.digest = Some(b.text.clone()); }
    w.emit(Some(&b.account), "digest", b.text, json!({}));
    ok(json!({}))
}

#[derive(Deserialize)]
pub struct LimIn { account: String, limits: Limits }

/// Agents tighten freely; they may raise risk back toward the user's ceiling only when earned (risk::agent_limits).
pub async fn limits(State(app): State<S>, h: HeaderMap, Json(b): Json<LimIn>) -> R {
    internal(&app, &h)?;
    let mut w = app.w.lock().unwrap();
    let px = w.prices();
    let a = w.accounts.get_mut(&b.account).ok_or(err(StatusCode::NOT_FOUND, "account"))?;
    let (cur, ceiling, rec) = (a.limits, Limits::profile(&a.profile), a.record(&px, now()));
    match agent_limits(&cur, &b.limits, &ceiling, &rec) {
        Ok(l) => {
            a.limits = l;
            let msg = if l.risk > cur.risk + 1e-12 { earned_msg(&cur, &l, &ceiling, &rec) } else { "AI agent tightened your limits.".into() };
            w.emit(Some(&b.account), "limits", msg, json!({"limits": l}));
            ok(json!({"ok": true}))
        }
        Err(code) => {
            w.emit(Some(&b.account), "gate_block", block_msg(code, &cur, &ceiling, &rec), json!({"code": code}));
            Err(err(StatusCode::FORBIDDEN, code))
        }
    }
}

pub fn earned_msg(cur: &Limits, new: &Limits, ceiling: &Limits, rec: &Record) -> String {
    format!("AI earned more risk: {:.1}% → {:.1}% per trade (your ceiling {:.1}%). Record: {}/{} wins, not losing today.",
        cur.risk * 100., new.risk * 100., ceiling.risk * 100., rec.wins, rec.closed)
}

pub fn block_msg(code: &str, cur: &Limits, ceiling: &Limits, rec: &Record) -> String {
    match code {
        "LIMIT_LOOSEN_DENIED" => format!("AI asked to go above your ceiling ({:.1}% per trade). Blocked: {code}. Only you can raise the ceiling.", ceiling.risk * 100.),
        "RISK_NOT_EARNED" => format!("AI asked to raise its risk from {:.1}% per trade. Blocked: {code}. It needs {}+ closed trades, {:.0}%+ wins and no loss today (has {}/{} wins, today {}).",
            cur.risk * 100., Record::MIN_TRADES, Record::MIN_WIN_RATE * 100., rec.wins, rec.closed, if rec.pnl_today >= 0. { "up" } else { "down" }),
        "RISK_STEP_TOO_BIG" => format!("AI asked to raise its risk by more than {:.0}% at once. Blocked: {code}.", MAX_RAISE_STEP * 100.),
        _ => format!("AI limit change blocked: {code}."),
    }
}

pub async fn audit_head(State(app): State<S>, h: HeaderMap) -> R {
    internal(&app, &h)?;
    let w = app.w.lock().unwrap();
    ok(json!({"seq": w.audit.last().map_or(0, |e| e.seq), "hash": w.audit.last().map(|e| e.hash.clone()),
        "last_anchored_seq": w.anchors.last().map_or(0, |a| a.seq)}))
}

#[derive(Deserialize)]
pub struct AnchorIn { seq: u64, hash: String, signature: String, cluster: String }

pub async fn audit_anchor(State(app): State<S>, h: HeaderMap, Json(b): Json<AnchorIn>) -> R {
    internal(&app, &h)?;
    let mut w = app.w.lock().unwrap();
    if !w.audit.iter().any(|e| e.seq == b.seq && e.hash == b.hash) { return Err(err(StatusCode::BAD_REQUEST, "hash does not match chain")) }
    w.anchors.push(Anchor { seq: b.seq, hash: b.hash.clone(), signature: b.signature.clone(), cluster: b.cluster.clone(), ts: now() });
    let short = |s: &str| s.chars().take(12).collect::<String>();
    w.emit(None, "anchor", format!("Audit trail anchored on Solana {}: events 1–{} fingerprint {}… (tx {}…)", b.cluster, b.seq, short(&b.hash), short(&b.signature)),
        json!({"seq": b.seq, "signature": b.signature, "cluster": b.cluster}));
    ok(json!({"ok": true}))
}
