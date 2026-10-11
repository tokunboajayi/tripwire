//! Server-Sent Events: each user sees global events, their own, and their replay's.
use crate::auth::{err, user_from_token};
use crate::{ApiErr, S};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::{Stream, StreamExt};
use serde::Deserialize;
use std::convert::Infallible;
use std::time::Duration;

#[derive(Deserialize)]
pub struct Tok { token: String }

pub async fn stream(State(app): State<S>, Query(q): Query<Tok>) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiErr> {
    let u = user_from_token(&app, &q.token).await.ok_or(err(StatusCode::UNAUTHORIZED, "token"))?;
    let rx = app.w.lock().unwrap().tx.subscribe();
    let rp = format!("replay:{u}");
    let s = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(move |e| {
        let out = match e {
            Ok(ev) if ev.account.is_none() || ev.account.as_deref() == Some(&u) || ev.account.as_deref() == Some(&rp) =>
                Some(Ok(Event::default().event(ev.kind.clone()).data(serde_json::to_string(&ev).unwrap()))),
            _ => None,
        };
        async move { out }
    });
    // keep-alive every 15s so proxies (Caddy) don't drop the stream
    Ok(Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}
