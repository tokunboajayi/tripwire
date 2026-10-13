use crate::audit::{verify_chain, GENESIS};
use crate::auth::err;
use crate::regime::regime;
use crate::{ok, R, S};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

pub async fn health() -> Json<Value> { Json(json!({"ok": true})) }

pub async fn config(State(app): State<S>) -> R {
    let mirror = app.w.lock().unwrap().mirror_user.is_some();
    ok(json!({
        "voice": std::env::var("ELEVENLABS_API_KEY").is_ok_and(|k| !k.is_empty()),
        "stocks": std::path::Path::new(&format!("{}/stocks.json", app.cfg.data_dir)).exists(),
        "mirror": mirror, "broker": app.cfg.broker, "pm": app.pm.cfg.mode, "symbols": app.cfg.symbols, "dev": app.cfg.dev, "guest": app.cfg.guest,
        "signin": if app.cfg.auth0_domain.is_some() { "auth0" } else if app.cfg.guest || app.cfg.dev { "name" } else { "none" },
    }))
}

/// Current regime + brain per symbol.
pub async fn regimes(State(app): State<S>) -> R {
    let w = app.w.lock().unwrap();
    ok(json!(w.markets.iter().map(|(s, m)| {
        let r = m.inds.row(m.candles.len() - 1);
        json!({"symbol": s, "price": m.price, "regime": m.fin, "brain": m.fin.brain(), "brain_label": m.fin.brain().label(),
            "regime_label": m.fin.label(), "deterministic": m.det, "source": m.source, "confidence": m.conf,
            "ai_reason": m.ai.as_ref().map(|a| a.2.clone()),
            "indicators": {"rsi2": r.rsi2, "adx": r.adx, "atrp_rank": r.atrp_rank, "ema50": r.ema50, "ema200": r.ema200, "sma200": r.sma200},
            "updated": m.updated, "feed": m.feed})
    }).collect::<Vec<_>>()))
}

#[derive(Deserialize)]
pub struct Days { days: Option<usize> }

/// Daily candles, each tagged with its deterministic regime (for the chart's background bands).
pub async fn candles(State(app): State<S>, Path(sym): Path<String>, Query(q): Query<Days>) -> R {
    let w = app.w.lock().unwrap();
    let m = w.markets.get(&sym.to_uppercase()).ok_or(err(StatusCode::NOT_FOUND, "symbol"))?;
    let n = m.candles.len();
    let from = n.saturating_sub(q.days.unwrap_or(365).min(2000));
    ok(json!((from..n).map(|i| {
        let c = m.candles[i];
        let r = m.inds.row(i);
        json!({"t": c.t, "o": c.o, "h": c.h, "l": c.l, "c": c.c, "v": c.v, "regime": if r.ready() { Some(regime(c.c, &r)) } else { None }})
    }).collect::<Vec<_>>()))
}

/// v2 backtest summary + curves (written by backtest/export_json.py).
pub async fn backtest(State(app): State<S>) -> R {
    let p = format!("{}/backtest.json", app.cfg.data_dir);
    let v: Value = std::fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str(&s).ok())
        .ok_or(err(StatusCode::NOT_FOUND, "run backtest/export_json.py"))?;
    ok(v)
}

#[derive(Deserialize)]
pub struct Since { since: Option<u64> }

pub async fn audit_list(State(app): State<S>, Query(q): Query<Since>) -> R {
    let w = app.w.lock().unwrap();
    let from = q.since.unwrap_or(0);
    ok(json!({"genesis": GENESIS, "entries": w.audit.iter().filter(|e| e.seq > from).collect::<Vec<_>>(), "anchors": &w.anchors}))
}

pub async fn audit_status(State(app): State<S>) -> R {
    let w = app.w.lock().unwrap();
    let last = w.anchors.last();
    ok(json!({"entries": w.audit.len(), "chain_ok": verify_chain(&w.audit).is_ok(), "head": w.audit.last().map(|e| (e.seq, e.hash.clone())),
        "anchored_seq": last.map(|a| a.seq), "signature": last.map(|a| a.signature.clone()), "cluster": last.map(|a| a.cluster.clone()),
        "anchored_at": last.map(|a| a.ts), "anchors": w.anchors.len()}))
}
