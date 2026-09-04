#!/usr/bin/env sh
set -eu

APP_DIR="/home/ubuntu/exchange-staging"
BACKUP_DIR="/home/ubuntu/exchange-placeholder-backup-20260903"
ARCHIVE="/home/ubuntu/full-exchange-deploy.tgz"

test -f "$ARCHIVE"
test ! -e "$BACKUP_DIR"

if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  docker compose down
  cd /home/ubuntu
  mv "$APP_DIR" "$BACKUP_DIR"
fi

mkdir -p "$APP_DIR" /home/ubuntu/nexa-staging-backups
tar -xzf "$ARCHIVE" -C "$APP_DIR"
cd "$APP_DIR"

umask 077
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
POSTGRES_APP_PASSWORD="$(openssl rand -hex 32)"
POSTGRES_MIGRATION_PASSWORD="$(openssl rand -hex 32)"
DATA_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
MONITORING_TOKEN="$(openssl rand -hex 32)"
SMOKE_PASSWORD="$(openssl rand -hex 24)"
BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
EMAIL_API_KEY="$(openssl rand -hex 32)"

cat > .env.staging <<EOF
STAGING_DOMAIN=exchange-staging.shopboostlabs.com
STAGING_URL=https://exchange-staging.shopboostlabs.com
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_APP_PASSWORD=$POSTGRES_APP_PASSWORD
POSTGRES_MIGRATION_PASSWORD=$POSTGRES_MIGRATION_PASSWORD
DATA_ENCRYPTION_KEY=$DATA_ENCRYPTION_KEY
MONITORING_TOKEN=$MONITORING_TOKEN
STAGING_SMOKE_EMAIL=staging-smoke@shopboostlabs.com
STAGING_SMOKE_PASSWORD=$SMOKE_PASSWORD
BACKUP_ENCRYPTION_KEY=$BACKUP_ENCRYPTION_KEY
OFFSITE_BACKUP_DIRECTORY=/home/ubuntu/nexa-staging-backups
BACKUP_RETENTION_DAYS=14
EMAIL_PROVIDER=generic
EMAIL_API_URL=https://email-disabled.invalid/send
EMAIL_API_KEY=$EMAIL_API_KEY
EMAIL_FROM=Nexa Exchange <noreply@shopboostlabs.com>
EOF
chmod 600 .env.staging

docker compose --env-file .env.staging -f compose.staging.yml config >/dev/null
docker compose --env-file .env.staging -f compose.staging.yml up -d --build
docker compose --env-file .env.staging -f compose.staging.yml ps
