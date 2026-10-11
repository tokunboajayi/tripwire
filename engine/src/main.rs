//! Vantrel engine: indicators, regimes, 3 brains + shield, risk gate, ledger, API, SSE, replay.
//! Source of truth: docs/03_BUILD_SPEC.md. Module map follows spec §2.
mod audit;
mod auth;
mod brains;
mod config;
mod executor;
mod indicators;
mod ledger;
mod market;
mod regime;
mod replay;
mod risk;
mod routes;
mod scheduler;
mod sse;
mod state;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{broadcast, OnceCell};

pub struct App {
    pub cfg: config::Cfg,
    pub w: Mutex<state::World>,
    pub http: reqwest::Client,
    pub jwks: OnceCell<jsonwebtoken::jwk::JwkSet>,
}
pub type S = Arc<App>;
pub type ApiErr = (StatusCode, String);
pub type R = Result<Response, ApiErr>;

pub fn now() -> i64 { chrono::Utc::now().timestamp() }
pub fn ok(v: Value) -> R { Ok(Json(v).into_response()) }

fn load_json<T: serde::de::DeserializeOwned + Default>(path: &str) -> T {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[tokio::main]
async fn main() {
    let cfg = config::Cfg::from_env();
    if let Err(e) = cfg.check() {
        eprintln!("refusing to start: {e}");
        std::process::exit(1);
    }
    let (tx, _) = broadcast::channel(1024);
    let (audit, anchors): (Vec<audit::Audit>, Vec<audit::Anchor>) = load_json(&format!("{}/audit.json", cfg.data_dir));
    let accounts: HashMap<String, ledger::Account> = load_json(&format!("{}/state.json", cfg.data_dir));
    let world = state::World::new(tx, accounts, audit, anchors, cfg.mirror_user.clone());
    let app: S = Arc::new(App {
        w: Mutex::new(world),
        http: reqwest::Client::builder().timeout(Duration::from_secs(20)).build().unwrap(),
        jwks: OnceCell::new(),
        cfg,
    });

    market::load_all(&app).await;
    scheduler::spawn(app.clone());

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", app.cfg.port)).await.unwrap();
    println!("vantrel engine on :{}{}", app.cfg.port, if app.cfg.dev { " (DEV sign-in enabled)" } else { "" });
    axum::serve(listener, routes::router(app).into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
}
