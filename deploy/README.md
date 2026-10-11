# deploy/
Owner. One Vultr VM runs everything (engine + dashboard + agents, optional Caddy HTTPS).

```bash
git clone https://github.com/tokunboajayi/tripwire.git && cd tripwire
# upload .env from your laptop (scp) -- never paste keys in chat
bash deploy/vultr-setup.sh               # -> http://<ip>:8080
bash deploy/vultr-setup.sh https         # after DOMAIN= in .env + GoDaddy DNS -> https://DOMAIN
```

Before deploying: set `INTERNAL_TOKEN` (`openssl rand -hex 24`) and `DEV=0` in `.env`. The engine refuses to start with the default token.
`/internal/*` (agent routes) answer only private-network callers with the token, and Caddy returns 404 for them.

Compose forces container paths (`DATA_DIR=/data`, `WEB_DIR=/app/web`) so a local-dev `.env` works unchanged.
Update after new commits: `git pull && docker compose --env-file .env -f deploy/docker-compose.yml up -d --build`.
Checks: `/v1/health` ok · `/v1/config` flags · `/v1/audit/status` · replay runs.
