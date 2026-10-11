//! Auth (spec §12): Auth0 RS256 JWTs for users, read-only MCP tokens, internal token for agents.
use crate::{App, ApiErr};
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;

pub fn err(c: StatusCode, m: &str) -> ApiErr { (c, m.into()) }

#[derive(Deserialize)]
struct Claims { sub: String }

async fn verify_jwt(app: &App, token: &str) -> Option<String> {
    use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
    let dom = app.cfg.auth0_domain.clone()?;
    let jwks = app.jwks.get_or_try_init(|| async { app.http.get(format!("https://{dom}/.well-known/jwks.json")).send().await?.json().await }).await.ok()?;
    let jwk = jwks.find(&decode_header(token).ok()?.kid?)?;
    let mut v = Validation::new(Algorithm::RS256);
    v.set_audience(&[&app.cfg.auth0_aud]);
    v.set_issuer(&[format!("https://{dom}/")]);
    decode::<Claims>(token, &DecodingKey::from_jwk(jwk).ok()?, &v).ok().map(|d| d.claims.sub)
}

/// `<name>.<16+ lowercase hex>`: the random part is the secret that makes a guest id unguessable.
pub fn guest_id_ok(id: &str) -> bool {
    match id.rsplit_once('.') {
        Some((name, key)) => !name.trim().is_empty() && name.chars().count() <= 40 && !name.contains('|')
            && key.len() >= 16 && key.len() <= 64 && key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        None => false,
    }
}

/// Resolve a bearer / query token to a user id.
pub async fn user_from_token(app: &App, t: &str) -> Option<String> {
    if app.cfg.dev {
        if let Some(u) = t.strip_prefix("dev:") { return Some(format!("dev|{u}")) }
    }
    if app.cfg.guest {
        if let Some(g) = t.strip_prefix("guest:") { return guest_id_ok(g).then(|| format!("guest|{g}")) }
    }
    verify_jwt(app, t).await
}

/// Returns (user, read_only). MCP tokens are read-only.
pub async fn who(app: &App, h: &HeaderMap) -> Result<(String, bool), ApiErr> {
    let hv = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).map(String::from);
    if let Some(t) = hv("x-mcp-token") {
        let w = app.w.lock().unwrap();
        return w.accounts.values().find(|a| a.mcp_token == t).map(|a| (a.user.clone(), true)).ok_or(err(StatusCode::UNAUTHORIZED, "bad mcp token"));
    }
    if let Some(t) = hv("authorization").as_deref().and_then(|b| b.strip_prefix("Bearer ")) {
        return user_from_token(app, t).await.map(|u| (u, false)).ok_or(err(StatusCode::UNAUTHORIZED, "bad token"));
    }
    if app.cfg.dev {
        if let Some(u) = hv("x-dev-user") { return Ok((format!("dev|{u}"), false)) }
    }
    Err(err(StatusCode::UNAUTHORIZED, "sign in"))
}

/// A user who may change things (not an MCP token).
pub async fn writer(app: &App, h: &HeaderMap) -> Result<String, ApiErr> {
    let (u, ro) = who(app, h).await?;
    if ro { Err(err(StatusCode::FORBIDDEN, "read-only token")) } else { Ok(u) }
}

/// Agents → engine.
pub fn internal(app: &App, h: &HeaderMap) -> Result<(), ApiErr> {
    if h.get("x-internal-token").and_then(|v| v.to_str().ok()) == Some(app.cfg.internal_token.as_str()) { Ok(()) }
    else { Err(err(StatusCode::UNAUTHORIZED, "internal")) }
}

#[cfg(test)]
mod tests {
    use super::guest_id_ok;
    #[test]
    fn guest_ids_need_a_random_key() {
        assert!(guest_id_ok("AJ.0123456789abcdef"));
        assert!(guest_id_ok("Mary Ann.0123456789abcdef0123"));
        assert!(!guest_id_ok("AJ"));                       // bare name: anyone could claim it
        assert!(!guest_id_ok("AJ.0123456789abcde"));       // 15 hex: too short
        assert!(!guest_id_ok("AJ.0123456789ABCDEF"));      // uppercase not produced by the client
        assert!(!guest_id_ok(".0123456789abcdef"));        // empty name
        assert!(!guest_id_ok("a|b.0123456789abcdef"));     // no id separator smuggling
    }
}
