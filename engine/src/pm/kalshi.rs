//! Kalshi (CFTC-regulated, US). Trade API v2: public order books, RSA-PSS signed portfolio calls.
//! Signature = base64(RSA-PSS-SHA256(timestamp_ms + METHOD + path)), path without the query string.
use super::arb::{Quote, Side};
use base64::Engine;
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs8::DecodePrivateKey;
use rsa::pss::BlindedSigningKey;
use rsa::signature::{RandomizedSigner, SignatureEncoding};
use rsa::RsaPrivateKey;
use serde_json::{json, Value};
use sha2::Sha256;

pub struct Kalshi { pub base: String, key_id: Option<String>, key: Option<BlindedSigningKey<Sha256>> }

fn load_key() -> Result<Option<RsaPrivateKey>, String> {
    let pem = match (std::env::var("KALSHI_PRIVATE_KEY").ok().filter(|s| !s.is_empty()), std::env::var("KALSHI_PRIVATE_KEY_PATH").ok().filter(|s| !s.is_empty())) {
        (Some(p), _) => p.replace("\\n", "\n"),
        (None, Some(path)) => std::fs::read_to_string(&path).map_err(|e| format!("KALSHI_PRIVATE_KEY_PATH: {e}"))?,
        _ => return Ok(None),
    };
    RsaPrivateKey::from_pkcs8_pem(&pem).or_else(|_| RsaPrivateKey::from_pkcs1_pem(&pem)).map(Some).map_err(|e| format!("Kalshi private key: {e}"))
}

impl Kalshi {
    pub fn from_env() -> Result<Kalshi, String> {
        let base = crate::config::env_or("KALSHI_URL", "https://api.elections.kalshi.com/trade-api/v2").trim_end_matches('/').to_string();
        let key_id = std::env::var("KALSHI_KEY_ID").ok().filter(|s| !s.is_empty());
        let key = load_key()?.map(BlindedSigningKey::<Sha256>::new);
        Ok(Kalshi { base, key_id, key })
    }
    pub fn has_keys(&self) -> bool { self.key_id.is_some() && self.key.is_some() }

    /// Full URL path that Kalshi signs, e.g. /trade-api/v2/portfolio/orders.
    fn signed_path(&self, endpoint: &str) -> String {
        let after_scheme = self.base.split_once("://").map_or(self.base.as_str(), |x| x.1);
        let prefix = after_scheme.find('/').map_or("", |i| &after_scheme[i..]);
        format!("{prefix}{}", endpoint.split('?').next().unwrap_or(endpoint))
    }

    fn auth(&self, rq: reqwest::RequestBuilder, method: &str, endpoint: &str) -> reqwest::RequestBuilder {
        let (Some(id), Some(key)) = (&self.key_id, &self.key) else { return rq };
        let ts = chrono::Utc::now().timestamp_millis().to_string();
        let msg = format!("{ts}{method}{}", self.signed_path(endpoint));
        let sig = key.sign_with_rng(&mut rand::thread_rng(), msg.as_bytes());
        rq.header("KALSHI-ACCESS-KEY", id).header("KALSHI-ACCESS-TIMESTAMP", ts)
            .header("KALSHI-ACCESS-SIGNATURE", base64::engine::general_purpose::STANDARD.encode(sig.to_bytes()))
    }

    async fn send(&self, http: &reqwest::Client, method: reqwest::Method, endpoint: &str, body: Option<Value>) -> Result<Value, String> {
        let mut rq = self.auth(http.request(method.clone(), format!("{}{endpoint}", self.base)), method.as_str(), endpoint);
        if let Some(b) = body { rq = rq.json(&b); }
        let r = rq.send().await.map_err(|e| format!("Kalshi network: {e}"))?;
        let st = r.status();
        let txt = r.text().await.unwrap_or_default();
        if !st.is_success() { return Err(format!("Kalshi HTTP {st}: {}", txt.chars().take(160).collect::<String>())) }
        serde_json::from_str(&txt).map_err(|e| format!("Kalshi JSON: {e}"))
    }

    /// Kalshi books list bids only. YES ask = $1 - best NO bid (and vice versa), size = the size at that bid.
    pub async fn quote(&self, http: &reqwest::Client, ticker: &str) -> Result<Quote, String> {
        let v = self.send(http, reqwest::Method::GET, &format!("/markets/{ticker}/orderbook"), None).await?;
        Ok(parse_book(&v["orderbook"]))
    }

    pub async fn balance(&self, http: &reqwest::Client) -> Result<f64, String> {
        let v = self.send(http, reqwest::Method::GET, "/portfolio/balance", None).await?;
        v["balance"].as_f64().map(|c| c / 100.).ok_or("Kalshi balance missing".into())
    }

    /// Settled markets: Some("yes"|"no"), otherwise None.
    pub async fn result(&self, http: &reqwest::Client, ticker: &str) -> Result<Option<String>, String> {
        let v = self.send(http, reqwest::Method::GET, &format!("/markets/{ticker}"), None).await?;
        let m = &v["market"];
        let done = matches!(m["status"].as_str(), Some("settled" | "finalized" | "determined"));
        Ok(if done { m["result"].as_str().filter(|r| *r == "yes" || *r == "no").map(String::from) } else { None })
    }

    /// Fill-or-kill limit buy at `price`: it fills completely at that price or not at all, so a leg never half-fills.
    pub async fn buy(&self, http: &reqwest::Client, ticker: &str, side: Side, contracts: f64, price: f64, client_id: &str) -> Result<Value, String> {
        let cents = (price * 100.).round() as i64;
        let (s, pk) = match side { Side::Yes => ("yes", "yes_price"), Side::No => ("no", "no_price") };
        let mut body = json!({"ticker": ticker, "client_order_id": client_id, "type": "limit", "action": "buy", "side": s,
            "count": contracts as i64, "time_in_force": "fill_or_kill"});
        body[pk] = json!(cents);
        self.send(http, reqwest::Method::POST, "/portfolio/orders", Some(body)).await
    }
}

pub fn parse_book(ob: &Value) -> Quote {
    let best = |k: &str| -> Option<(f64, f64)> {
        ob[k].as_array()?.iter().filter_map(|l| Some((l.get(0)?.as_f64()?, l.get(1)?.as_f64()?))).max_by(|a, b| a.0.total_cmp(&b.0))
    };
    let (yb, nb) = (best("yes"), best("no"));
    Quote {
        yes_ask: nb.map(|(p, _)| (100. - p) / 100.), yes_size: nb.map_or(0., |x| x.1),
        no_ask: yb.map(|(p, _)| (100. - p) / 100.), no_size: yb.map_or(0., |x| x.1),
        ts: chrono::Utc::now().timestamp(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn book_bids_become_asks() {
        let q = parse_book(&json!({"yes": [[38, 100], [40, 25]], "no": [[55, 10], [58, 70]]}));
        assert_eq!((q.yes_ask, q.yes_size, q.no_ask, q.no_size), (Some(0.42), 70., Some(0.60), 25.));
        let empty = parse_book(&json!({"yes": null, "no": []}));
        assert_eq!((empty.yes_ask, empty.no_ask), (None, None));
    }
    #[test]
    fn signs_the_full_path_without_query() {
        let k = Kalshi { base: "https://x.com/trade-api/v2".into(), key_id: None, key: None };
        assert_eq!(k.signed_path("/portfolio/orders?limit=5"), "/trade-api/v2/portfolio/orders");
    }
}
