#!/usr/bin/env bash
# Builds the app locally, uploads it to the EC2 server and (re)starts it.
# Safe to re-run for every new release.   ./deploy/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/deploy/.deploy-env"

SSH_OPTS=(-i "$KEY_PATH" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
TARGET="ubuntu@$EC2_IP"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Building frontend"
(cd "$ROOT/frontend" && npm ci && npm run build)

echo "==> Packaging"
tar czf "$TMP/hotel-app.tgz" -C "$ROOT" \
  --exclude='node_modules' --exclude='.env' --exclude='.deploy-env' \
  backend frontend/dist deploy/nginx.conf

# Production env file for the API
umask 077
cat > "$TMP/backend.env" <<EOF
PORT=4000
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES=12h
DATABASE_URL=postgres://hotel_admin:$DB_PASSWORD@$DB_HOST:5432/hotels
DB_SSL=true
DB_POOL_MAX=15
BCRYPT_ROUNDS=10
CORS_ORIGIN=*
LOGIN_RATE_MAX=1000
EOF

echo "==> Uploading to $EC2_IP (waiting for SSH...)"
for i in $(seq 1 20); do
  ssh "${SSH_OPTS[@]}" "$TARGET" 'echo ready' >/dev/null 2>&1 && break
  sleep 6
done
ssh "${SSH_OPTS[@]}" "$TARGET" 'mkdir -p ~/upload'
scp "${SSH_OPTS[@]}" "$TMP/hotel-app.tgz" "$TMP/backend.env" "$ROOT/deploy/setup-ec2.sh" "$TARGET:~/upload/"

echo "==> Installing and starting on the server"
ssh "${SSH_OPTS[@]}" "$TARGET" "sudo RUN_SEED=\${RUN_SEED:-true} bash ~/upload/setup-ec2.sh"

echo
echo "Live at: http://$EC2_IP"
echo "Demo login: admin@hotels.test / Hotel@12345"
echo "Load test: node loadtest/node-load.js http://$EC2_IP 100 120"
