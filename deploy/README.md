# deploy/

One Vultr VM runs everything: engine + dashboard (the website, landing page included), agents, Caddy HTTPS for your GoDaddy domain.

## 1 · Vultr VM (once)
Ubuntu 24.04, 2 GB RAM or more (the script adds swap for the Rust build). Then on the server:
```bash
git clone https://github.com/tokunboajayi/tripwire.git && cd tripwire
# from your laptop: scp .env root@<server-ip>:~/tripwire/.env   (never paste keys in chat)
```
In that `.env` set at least:
```
DEV=0
INTERNAL_TOKEN=<openssl rand -hex 24>
DOMAIN=getwiththeprogram.study
PUBLIC_ORIGIN=https://getwiththeprogram.study
```
The engine refuses to start with the default token.

## 2 · GoDaddy DNS (once)
GoDaddy → My Products → your domain → **DNS** → Records:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `<server-ip>` | 600 |
| CNAME | `www` | `@` | 1 hour |

Delete any other `A @` record (GoDaddy's "Parked" one). Check with `dig +short getwiththeprogram.study` → your server IP.

## 3 · Start it
```bash
bash deploy/vultr-setup.sh https      # Docker, swap, firewall, build, start; Caddy gets the HTTPS cert
```
Live at `https://getwiththeprogram.study` (Caddy issues the certificate automatically once DNS points at the server).
If you use Auth0, add `https://getwiththeprogram.study` to the app's Allowed Callback, Logout and Web Origin URLs.

## 4 · Auto-deploy on every merge to main
Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `VULTR_HOST` | server IP |
| `VULTR_SSH_KEY` | a private key; put its public half in the server's `~/.ssh/authorized_keys` |
| `SITE_URL` | `https://getwiththeprogram.study` (optional, checked after each deploy) |
| `VULTR_USER` / `DEPLOY_DIR` | optional, default `root` / `~/tripwire` |

Make a dedicated key: `ssh-keygen -t ed25519 -f vantrel_deploy -N ""`, then `ssh-copy-id -i vantrel_deploy.pub root@<server-ip>`, and paste the contents of `vantrel_deploy` into `VULTR_SSH_KEY`.
After that, `.github/workflows/deploy.yml` runs when CI passes on `main`: pull, rebuild, health-check. Run it by hand from the Actions tab any time.

## Notes
- `/internal/*` (agent routes) answer only private-network callers with the token, and Caddy returns 404 for them.
- Compose forces container paths (`DATA_DIR=/data`, `WEB_DIR=/app/web`), so a local-dev `.env` works unchanged.
- Data (accounts, audit chain) lives in the `tripwire-data` Docker volume and survives rebuilds.
- Manual update: `git pull && docker compose --env-file .env -f deploy/docker-compose.yml --profile https up -d --build`.
- Checks: `/v1/health` · `/v1/config` · `/v1/audit/status`.
