//! Config from env (spec §13). `.env` at the repo root is loaded first; real env vars win.
pub fn env_or(k: &str, d: &str) -> String { std::env::var(k).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| d.into()) }
fn env_opt(k: &str) -> Option<String> { std::env::var(k).ok().filter(|v| !v.is_empty()) }

pub const DEFAULT_INTERNAL_TOKEN: &str = "change-me";
/// What LIVE_CONFIRM must say before BROKER=live starts.
pub const LIVE_CONFIRM_PHRASE: &str = "real-money";

pub struct Cfg {
    pub symbols: Vec<String>,
    /// DEV=1 enables name-only sign-in (`X-Dev-User` / `dev:<name>` tokens). Never on a public box.
    pub dev: bool,
    /// Guest sign-in: a name plus a browser-generated random id (`guest:<name>.<16+ hex>`), so names can't be hijacked.
    /// GUEST_SIGNIN=1/0, default on (also alongside Auth0). Paper money only, so this is safe on a public box.
    pub guest: bool,
    pub internal_token: String,
    pub auth0_domain: Option<String>,
    pub auth0_aud: String,
    pub data_dir: String,
    pub owner: Option<String>,
    pub market_url: String,
    pub web_dir: String,
    pub fixtures_dir: String,
    pub port: u16,
    /// CORS origin for the web app. Same-origin deploys don't need it.
    pub public_origin: Option<String>,
    pub mirror_user: Option<String>,
    /// Live price refresh interval (seconds); trading decisions still run every 60s.
    pub price_every_s: u64,
    /// ElevenLabs API base (override only for tests).
    pub elevenlabs_url: String,
    /// BROKER=off|paper|live. Default: paper when MIRROR_USER is set, else off. Live needs LIVE_CONFIRM (see check()).
    pub broker: crate::broker::Mode,
    /// Dollar caps for the broker (BROKER_CAPITAL_USD, LIVE_MAX_*).
    pub guard: crate::broker::Guard,
    /// Raw BROKER value, kept so check() can reject a typo instead of silently falling back.
    broker_raw: String,
    live_confirm: String,
}

impl Cfg {
    pub fn from_env() -> Cfg {
        let _ = dotenvy::from_filename("../.env").or_else(|_| dotenvy::dotenv());
        let broker_raw = env_or("BROKER", if env_opt("MIRROR_USER").is_some() { "paper" } else { "off" }).to_lowercase();
        Cfg {
            symbols: env_or("SYMBOLS", "BTC,ETH,SOL").split(',').map(|s| s.trim().split('/').next().unwrap().to_uppercase()).collect(),
            dev: env_or("DEV", "0") == "1",
            guest: env_or("GUEST_SIGNIN", "1") == "1",
            internal_token: env_or("INTERNAL_TOKEN", DEFAULT_INTERNAL_TOKEN),
            auth0_domain: env_opt("AUTH0_DOMAIN"),
            auth0_aud: env_or("AUTH0_AUDIENCE", ""),
            data_dir: env_or("DATA_DIR", "./data"),
            owner: env_opt("OWNER_USER"),
            market_url: env_or("MARKET_URL", "https://data-api.binance.vision"),
            web_dir: env_or("WEB_DIR", "../web/dist"),
            fixtures_dir: env_or("OFFLINE_FIXTURES", "../backtest/fixtures"),
            port: env_or("PORT", "8080").parse().unwrap_or(8080),
            public_origin: env_opt("PUBLIC_ORIGIN"),
            mirror_user: env_opt("MIRROR_USER"),
            price_every_s: env_or("PRICE_EVERY_S", "10").parse::<u64>().unwrap_or(10).clamp(2, 60),
            elevenlabs_url: env_or("ELEVENLABS_URL", "https://api.elevenlabs.io"),
            broker: crate::broker::Mode::parse(&broker_raw).unwrap_or(crate::broker::Mode::Off),
            guard: crate::broker::Guard::from_env(env_or("BROKER_CAPITAL_USD", "").parse::<f64>().ok().filter(|c| *c > 0.).unwrap_or(10_000.)),
            broker_raw,
            live_confirm: env_or("LIVE_CONFIRM", ""),
        }
    }

    /// Refuse to run with a guessable agent token unless in local dev.
    pub fn check(&self) -> Result<(), String> {
        if !self.dev && (self.internal_token == DEFAULT_INTERNAL_TOKEN || self.internal_token.len() < 16) {
            return Err("INTERNAL_TOKEN must be set to a random value (16+ chars) when DEV != 1".into());
        }
        use crate::broker::{keys_set, Mode};
        if Mode::parse(&self.broker_raw).is_none() { return Err(format!("BROKER must be off, paper or live (got {:?})", self.broker_raw)) }
        if self.broker != Mode::Off && self.mirror_user.is_none() { return Err("BROKER needs MIRROR_USER: the one account whose trades go to the broker".into()) }
        if self.broker == Mode::Live {
            // Real money: every one of these must be deliberate.
            if self.live_confirm != LIVE_CONFIRM_PHRASE { return Err(format!("BROKER=live trades real money. Set LIVE_CONFIRM={LIVE_CONFIRM_PHRASE} to confirm")) }
            if self.dev { return Err("BROKER=live is not allowed with DEV=1 (anyone could sign in as anyone)".into()) }
            if self.mirror_user.as_deref().is_some_and(|u| u.starts_with("dev|")) { return Err("MIRROR_USER can't be a dev| account in live mode".into()) }
            if env_opt("BROKER_CAPITAL_USD").is_none() { return Err("BROKER=live needs BROKER_CAPITAL_USD: the dollars you allow it to trade".into()) }
            if !keys_set(Mode::Live) { return Err("BROKER=live needs APCA_LIVE_KEY_ID and APCA_LIVE_SECRET_KEY (separate from the paper keys)".into()) }
            if self.guard.max_order > self.guard.capital || self.guard.max_deployed > self.guard.capital {
                return Err("LIVE_MAX_ORDER_USD and LIVE_MAX_DEPLOYED_USD can't exceed BROKER_CAPITAL_USD".into())
            }
        }
        Ok(())
    }
}
