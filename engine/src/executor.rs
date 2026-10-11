//! Alpaca paper mirror (spec §6). The ledger always uses the simulated fill so every user stays consistent;
//! the mirror account additionally sends the order to a real broker paper account.
use crate::{config::env_or, S};
use serde_json::{json, Value};

pub async fn mirror_order(app: &S, sym: &str, side: &str, qty: f64) {
    let (Ok(k), Ok(sec)) = (std::env::var("APCA_API_KEY_ID"), std::env::var("APCA_API_SECRET_KEY")) else { return };
    let url = format!("{}/v2/orders", env_or("APCA_PAPER_URL", "https://paper-api.alpaca.markets"));
    let body = json!({"symbol": format!("{sym}/USD"), "qty": format!("{qty:.6}"), "side": side, "type": "market", "time_in_force": "gtc",
        "client_order_id": format!("vt-{}", uuid::Uuid::new_v4().simple())});
    let res = app.http.post(url).header("APCA-API-KEY-ID", k).header("APCA-API-SECRET-KEY", sec).json(&body).send().await;
    let (msg, ok) = match res {
        Ok(r) if r.status().is_success() => {
            let v: Value = r.json().await.unwrap_or_default();
            (format!("Mirrored to Alpaca paper: {side} {qty:.4} {sym} (order {}, status {}).", v["id"].as_str().unwrap_or("?"), v["status"].as_str().unwrap_or("?")), true)
        }
        Ok(r) => {
            let st = r.status();
            (format!("Alpaca paper mirror rejected {side} {sym}: HTTP {st} {}", r.text().await.unwrap_or_default().chars().take(120).collect::<String>()), false)
        }
        Err(e) => (format!("Alpaca paper mirror failed: {e}"), false),
    };
    let mut w = app.w.lock().unwrap();
    let u = w.mirror_user.clone();
    w.emit(u.as_deref(), "mirror", msg, json!({"ok": ok, "symbol": sym, "side": side}));
}
