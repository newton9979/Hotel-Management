#!/usr/bin/env bash
# Runs ON the EC2 instance (Ubuntu 22.04/24.04) as root. Called by deploy/deploy.sh.
# Expects in /home/ubuntu/upload: hotel-app.tgz, backend.env
set -euo pipefail

APP_DIR=/opt/hotel-app
APP_USER=ubuntu
UPLOAD=/home/ubuntu/upload
RUN_SEED="${RUN_SEED:-true}"

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
apt-get update -y
apt-get install -y nginx build-essential postgresql-client curl ca-certificates

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

echo "==> Unpacking application"
mkdir -p "$APP_DIR"
# keep node_modules and .env across deploys; replace code
tar xzf "$UPLOAD/hotel-app.tgz" -C "$APP_DIR"
install -m 600 "$UPLOAD/backend.env" "$APP_DIR/backend/.env"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Installing backend dependencies"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/backend && npm ci --omit=dev"

echo "==> Running database migration"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/backend && node src/migrate.js"
if [ "$RUN_SEED" = "true" ]; then
  echo "==> Seeding demo data (skipped automatically if data exists)"
  sudo -u "$APP_USER" bash -c "cd $APP_DIR/backend && node src/seed.js"
fi

echo "==> Starting API with PM2"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/backend && pm2 startOrReload ecosystem.config.js --update-env && pm2 save"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

echo "==> Configuring nginx"
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/hotel
ln -sf /etc/nginx/sites-available/hotel /etc/nginx/sites-enabled/hotel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

echo "==> Health check"
sleep 3
curl -fsS http://127.0.0.1/api/health && echo
echo "Deployment complete."
