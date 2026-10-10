# deploy/
Owner. One VM (Vultr) runs everything.
```bash
cp .env.example .env            # fill keys; set DEV=0 + AUTH0_* for public sign-in
docker compose -f deploy/docker-compose.yml up -d --build                    # http://<ip>:8080
docker compose -f deploy/docker-compose.yml --profile https up -d            # HTTPS via Caddy (edit Caddyfile domain)
```

Checks before the demo: `/v1/health` → ok · `/v1/config` shows voice/stocks/mirror flags · sign in · replay runs.
Note: `.env` must exist next to the repo root before `docker compose up`.
