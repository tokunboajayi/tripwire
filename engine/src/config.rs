//! Config from env (spec §13). `.env` at the repo root is loaded first; real env vars win.
pub fn env_or(k: &str, d: &str) -> String { std::env::var(k).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| d.into()) }
fn env_opt(k: &str) -> Option<String> { std::env::var(k).ok().filter(|v| !v.is_empty()) }

pub const DEFAULT_INTERNAL_TOKEN: &str = "change-me";

pub struct Cfg {
    pub symbols: Vec<String>,
    /// DEV=1 enables name-only sign-in (`X-Dev-User` / `dev:<name>` tokens). Never on a public box.
    pub dev: bool,
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
}

impl Cfg {
    pub fn from_env() -> Cfg {
        let _ = dotenvy::from_filename("../.env").or_else(|_| dotenvy::dotenv());
        Cfg {
            symbols: env_or("SYMBOLS", "BTC,ETH,SOL").split(',').map(|s| s.trim().split('/').next().unwrap().to_uppercase()).collect(),
            dev: env_or("DEV", "0") == "1",
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
        }
    }

    /// Refuse to run with a guessable agent token unless in local dev.
    pub fn check(&self) -> Result<(), String> {
        if !self.dev && (self.internal_token == DEFAULT_INTERNAL_TOKEN || self.internal_token.len() < 16) {
            return Err("INTERNAL_TOKEN must be set to a random value (16+ chars) when DEV != 1".into());
        }
        Ok(())
    }
}
