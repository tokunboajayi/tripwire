//! Polymarket CLOB order books (read-only). Each outcome is its own token; the best ask on the NO token is the price
//! of NO. Placing Polymarket orders needs a wallet signature (EIP-712) and venue access that depends on where you
//! live, so it is deliberately not implemented: Polymarket legs trade in paper mode only until that's verified.
use super::arb::Quote;
use serde_json::Value;

fn num(v: &Value) -> Option<f64> { v.as_f64().or_else(|| v.as_str()?.parse().ok()) }

pub async fn quote(http: &reqwest::Client, base: &str, token: &str) -> Result<Quote, String> {
    let r = http.get(format!("{}/book", base.trim_end_matches('/'))).query(&[("token_id", token)]).send().await
        .map_err(|e| format!("Polymarket network: {e}"))?;
    if !r.status().is_success() { return Err(format!("Polymarket HTTP {}", r.status())) }
    let v: Value = r.json().await.map_err(|e| format!("Polymarket JSON: {e}"))?;
    Ok(parse_book(&v))
}

/// Best (lowest) ask for this token, as a Quote whose `yes_*` fields describe the token itself.
pub fn parse_book(v: &Value) -> Quote {
    let best = v["asks"].as_array().into_iter().flatten()
        .filter_map(|l| Some((num(&l["price"])?, num(&l["size"])?))).filter(|(p, s)| *p > 0. && *s > 0.)
        .min_by(|a, b| a.0.total_cmp(&b.0));
    Quote { yes_ask: best.map(|x| x.0), yes_size: best.map_or(0., |x| x.1), no_ask: None, no_size: 0., ts: chrono::Utc::now().timestamp() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lowest_ask_wins() {
        let q = parse_book(&serde_json::json!({"asks": [{"price": "0.55", "size": "10"}, {"price": "0.52", "size": "300"}], "bids": []}));
        assert_eq!((q.yes_ask, q.yes_size), (Some(0.52), 300.));
        assert_eq!(parse_book(&serde_json::json!({"asks": []})).yes_ask, None);
    }
}
