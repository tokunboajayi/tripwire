//! HTTP API (spec §9).
mod account;
mod internal;
mod public;

use crate::{sse, S};
use axum::extract::{ConnectInfo, DefaultBodyLimit, Request};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, patch, post};
use axum::Router;
use std::net::{IpAddr, SocketAddr};
use tower_http::cors::CorsLayer;

/// Loopback, RFC 1918, CGNAT (docker / VPC networks) and IPv6 unique-local addresses.
fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64),
        IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00 || v6.to_ipv4_mapped().is_some_and(|v4| is_private(IpAddr::V4(v4))),
    }
}

/// Agent routes answer only callers on a private network (spec §12: bind /internal to the docker network).
async fn private_only(req: Request, next: Next) -> Result<Response, StatusCode> {
    match req.extensions().get::<ConnectInfo<SocketAddr>>() {
        Some(ConnectInfo(addr)) if is_private(addr.ip()) => Ok(next.run(req).await),
        _ => Err(StatusCode::NOT_FOUND),
    }
}

/// Hashed bundles (/assets/*) are immutable; everything else (index.html, the SPA routes) must be re-checked on every
/// load, or browsers keep showing the previous release after a deploy.
async fn cache_policy(req: Request, next: Next) -> Response {
    let assets = req.uri().path().starts_with("/assets/");
    let mut res = next.run(req).await;
    let v = if assets { "public, max-age=31536000, immutable" } else { "no-cache" };
    if res.status().is_success() { res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(v)); }
    res
}

pub fn router(app: S) -> Router {
    let web = tower_http::services::ServeDir::new(&app.cfg.web_dir)
        .fallback(tower_http::services::ServeFile::new(format!("{}/index.html", app.cfg.web_dir)));
    let cors = match app.cfg.public_origin.as_deref().and_then(|o| o.parse::<HeaderValue>().ok()) {
        Some(o) => CorsLayer::new().allow_origin(o)
            .allow_methods([Method::GET, Method::POST, Method::PATCH])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, "x-dev-user".parse().unwrap()]),
        None => CorsLayer::new(), // same-origin only
    };
    // agents (X-Internal-Token + private network only). Also blocked at the public proxy; see deploy/Caddyfile.
    let internal = Router::new()
        .route("/internal/snapshot", get(internal::snapshot))
        .route("/internal/regime", post(internal::regime))
        .route("/internal/positions", get(internal::positions))
        .route("/internal/thesis", post(internal::thesis))
        .route("/internal/exit", post(internal::exit))
        .route("/internal/stream", post(internal::stream))
        .route("/internal/accounts", get(internal::accounts))
        .route("/internal/digest", post(internal::digest))
        .route("/internal/limits", post(internal::limits))
        .route("/internal/audit/head", get(internal::audit_head))
        .route("/internal/audit/anchor", post(internal::audit_anchor))
        .route_layer(middleware::from_fn(private_only));
    Router::new()
        // public
        .route("/v1/health", get(public::health))
        .route("/v1/config", get(public::config))
        .route("/v1/market/regimes", get(public::regimes))
        .route("/v1/market/:sym/candles", get(public::candles))
        .route("/v1/backtest", get(public::backtest))
        .route("/v1/audit", get(public::audit_list))
        .route("/v1/audit/status", get(public::audit_status))
        // user
        .route("/v1/accounts", post(account::create))
        .route("/v1/accounts/me", get(account::me))
        .route("/v1/accounts/me/profile", patch(account::set_profile))
        .route("/v1/accounts/me/positions", get(account::positions))
        .route("/v1/accounts/me/trades", get(account::trades))
        .route("/v1/accounts/me/equity", get(account::equity))
        .route("/v1/accounts/me/events", get(account::events))
        .route("/v1/accounts/me/:action", post(account::action))
        .route("/v1/stream", get(sse::stream))
        .route("/v1/replays", post(account::start_replay))
        .route("/v1/replays/me", get(account::get_replay))
        .route("/v1/replays/me/stop", post(account::stop_replay))
        .route("/v1/voice", get(account::voice))
        .route("/v1/admin/kill-all", post(account::kill_all))
        .route("/v1/live", get(account::live_status))
        .route("/v1/live/:action", post(account::live_action))
        .route("/v1/ladder", get(account::ladder_status))
        .route("/v1/ladder/raise", post(account::ladder_raise))
        .route("/v1/ladder/settings", post(account::ladder_settings))
        .route("/v1/pm", get(account::pm_status))
        .route("/v1/pm/:action", post(account::pm_action))
        .route("/v1/pm/positions/:id/settle", post(account::pm_settle))
        .merge(internal)
        .with_state(app)
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(cors)
        .fallback_service(Router::new().fallback_service(web).layer(middleware::from_fn(cache_policy)))
}

#[cfg(test)]
mod tests {
    use super::is_private;

    #[test]
    fn private_network_check() {
        for ip in ["127.0.0.1", "10.1.2.3", "172.18.0.5", "192.168.1.9", "100.64.0.1", "::1", "fd00::1", "::ffff:172.18.0.2"] {
            assert!(is_private(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860::8888", "::ffff:1.1.1.1"] {
            assert!(!is_private(ip.parse().unwrap()), "{ip}");
        }
    }
}
