#!/bin/sh
set -eu

if [ -z "${POSTGRES_APP_PASSWORD:-}" ] || [ -z "${POSTGRES_MIGRATION_PASSWORD:-}" ]; then
  echo "POSTGRES_APP_PASSWORD and POSTGRES_MIGRATION_PASSWORD are required" >&2
  exit 1
fi

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$POSTGRES_APP_PASSWORD" \
  --set=migration_password="$POSTGRES_MIGRATION_PASSWORD" <<-'EOSQL'
SELECT format('CREATE ROLE nexa_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexa_app') \gexec
SELECT format('CREATE ROLE nexa_migrator LOGIN PASSWORD %L', :'migration_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexa_migrator') \gexec
ALTER ROLE nexa_app PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE nexa_migrator PASSWORD :'migration_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE exchange TO nexa_app;
GRANT CONNECT ON DATABASE exchange TO nexa_migrator;
GRANT USAGE ON SCHEMA public TO nexa_app;
GRANT USAGE, CREATE ON SCHEMA public TO nexa_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE nexa_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nexa_migrator IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO nexa_app;
EOSQL
