# deploy/
Owner. One VM (Vultr) runs everything.
```bash
cp .env.example .env            # fill keys; set DEV=0 + AUTH0_* for public sign-in
docker compose -f deploy/docker-compose.yml up -d --build                    # http://<ip>:8080
docker compose -f deploy/docker-compose.yml --profile https up -d            # HTTPS via Caddy (edit Caddyfile domain)
```
