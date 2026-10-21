#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/bizmanager"
BACKEND_DIR="$APP_DIR/backend"
VENV_BIN="$APP_DIR/.venv/bin"
SERVICE_NAME="backend"
NGINX_SERVICE="nginx"
API_BASE_URL="${VITE_API_BASE:-https://typingcentersystem.cloud/api}"

echo "==> Deploying from $APP_DIR"
cd "$APP_DIR"

echo "==> Reconcile migration files"
# Migration files are now committed to the repo (they used to be git-ignored
# and generated per-server, which is why financial_control tables were never
# created in production). On servers that still have locally-generated,
# untracked migration files, `git pull` would abort with
# "untracked working tree files would be overwritten". The repository is now
# the single source of truth for migrations; already-applied migration history
# lives safely in the DB's django_migrations table, not in these files.
# So we drop any untracked/ignored files inside */migrations/ before pulling.
git clean -fdx backend/*/migrations

echo "==> Pull latest code"
git pull

echo "==> Install backend deps"
if [ ! -x "$VENV_BIN/python" ]; then
  echo "Virtualenv not found at $VENV_BIN. Create it first."
  exit 1
fi
source "$VENV_BIN/activate"
pip install -r "$BACKEND_DIR/requirements.txt"

echo "==> Migrations"
cd "$BACKEND_DIR"
# Migrations are committed to the repo and applied deterministically here.
# Do NOT run `makemigrations` on the server: it hides errors and silently
# skips apps whose migration package wasn't deployed (this is what caused
# the Financial Control tables to be missing in production).
python manage.py migrate --noinput

echo "==> Collect static"
python manage.py collectstatic --noinput

echo "==> Restart backend service"
sudo systemctl restart "$SERVICE_NAME"

echo "==> Build frontend"
cd "$APP_DIR"
export VITE_API_BASE="$API_BASE_URL"
npm install
npm run build

echo "==> Reload nginx"
sudo nginx -t
sudo systemctl reload "$NGINX_SERVICE"

echo "==> Done."
