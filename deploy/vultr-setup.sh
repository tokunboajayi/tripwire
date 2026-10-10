#!/usr/bin/env bash
# Tripwire one-shot server setup (Ubuntu 22.04/24.04 on Vultr).
# Usage (from repo root, after .env is on the server):
#   bash deploy/vultr-setup.sh            -> http://<server-ip>:8080
#   bash deploy/vultr-setup.sh https      -> also HTTPS via Caddy (needs DOMAIN= in .env + DNS pointed here)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "ERROR: .env missing in $(pwd). Upload it first (scp), never paste keys in chat."; exit 1; }

if ! command -v docker >/dev/null; then
  echo "== installing Docker"; curl -fsSL https://get.docker.com | sh
fi

# Rust release build needs ~3GB RAM; add swap on small boxes.
if [ "$(free -m | awk '/Swap/{print $2}')" -lt 1000 ]; then
  echo "== adding 4G swap"; fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 8080/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null; echo "== firewall: 22, 80, 443, 8080 open"
fi

PROFILE=""; [ "${1:-}" = "https" ] && PROFILE="--profile https"
grep -qE "^PHOTON_PROJECT_ID=.+" .env && PROFILE="$PROFILE --profile imessage" && echo "== iMessage agent enabled"
echo "== building + starting (first build ~10-15 min)"
docker compose --env-file .env -f deploy/docker-compose.yml $PROFILE up -d --build

echo "== waiting for engine"
for i in $(seq 1 60); do curl -fs localhost:8080/v1/health >/dev/null && break; sleep 3; done
curl -fs localhost:8080/v1/health && echo
curl -fs localhost:8080/v1/config && echo
IP=$(curl -fs4 ifconfig.me || hostname -I | awk '{print $1}')
echo "== LIVE: http://$IP:8080   (logs: docker compose -f deploy/docker-compose.yml logs -f)"
