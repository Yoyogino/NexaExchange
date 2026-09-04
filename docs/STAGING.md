# Staging deployment

This deployment remains a simulated exchange. Do not connect wallets, payment rails, or real customer assets.

## Prerequisites

- A Linux host with Docker Compose
- A DNS record for the staging hostname pointing to the host
- Ports 80 and 443 open for Caddy certificate issuance
- Secrets supplied through the host or deployment secret manager

## Configure

Copy `.env.staging.example` to `.env.staging` and replace every placeholder. Generate `DATA_ENCRYPTION_KEY` as a base64-encoded 32-byte value. Use different long random values for `POSTGRES_PASSWORD` (database owner), `POSTGRES_MIGRATION_PASSWORD` (schema migration), and `POSTGRES_APP_PASSWORD` (restricted API account). Configure a dedicated simulated-only `STAGING_SMOKE_EMAIL` and a unique `STAGING_SMOKE_PASSWORD`; never reuse a personal or production credential. Never commit the completed file.

The initialization script creates `nexa_migrator` and `nexa_app` without superuser, database-creation, role-creation, or replication privileges. A one-shot migration container owns schema changes and must finish successfully before the API starts. The API receives only the runtime credential and has no schema-creation permission; keep the owner credential for initialization and database operations.

Before starting or deploying, run `npm run validate:staging-env`. This offline preflight rejects example values, weak or reused secrets, an invalid encryption key, mismatched HTTPS hostnames, and incomplete email-provider settings.

## Validate and start

```sh
docker compose --env-file .env.staging -f compose.staging.yml config
docker compose --env-file .env.staging -f compose.staging.yml up -d --build
```

Check readiness through the HTTPS hostname:

```text
https://exchange-staging.example.com/api/ready
```

Run the automated validation from the project folder:

```sh
npm run validate:staging
```

It waits up to three minutes for the public HTTPS readiness endpoint, with a five-second timeout on each attempt. It then verifies the web application, PostgreSQL and Redis readiness, HTTPS security headers, protected metrics, and a dedicated simulated account flow. The account check registers the smoke account on its first run, signs in on later runs, verifies its BTC/USDT wallets and read-only trading APIs, then signs out. It does not place orders or modify balances.

## Read-only load test

After ordinary staging validation, run a bounded read-only test from a separate machine. Set `LOAD_TEST_CONFIRM=simulated-only`, `LOAD_TEST_URL` to the HTTPS staging origin, and optionally tune `LOAD_TEST_CONCURRENCY` (maximum 100) and `LOAD_TEST_DURATION_SECONDS` (maximum 1800), then run `npm run load-test`. The report includes success/failure counts and p50/p95 latency.

To include live-event connection and reconnect behavior, set `LOAD_TEST_COOKIE` to a dedicated test account's complete `nexa_session=...` cookie and optionally set `LOAD_TEST_STREAMS` (maximum 50). Never use a real user's cookie, paste it into logs, or retain it after the test. The tool performs no registrations, orders, cancellations, or other state changes.

The application container is not published directly. Caddy is the only public entry point and supplies HTTPS. PostgreSQL and Redis remain on the private Compose network.

## Scheduled encrypted backups

Create the host directory configured by `OFFSITE_BACKUP_DIRECTORY` before deployment. It must be a secure mounted or synchronized off-machine destination. Keep `BACKUP_ENCRYPTION_KEY` in the protected staging environment and separately in a recovery secret manager; it must not be the same as `DATA_ENCRYPTION_KEY`.

After deployment, install the supplied user-level systemd units from the staging project directory:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/systemd/nexa-exchange-backup.service deploy/systemd/nexa-exchange-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now nexa-exchange-backup.timer
systemctl --user start nexa-exchange-backup.service
systemctl --user status nexa-exchange-backup.service
```

The one-shot service creates a PostgreSQL dump inside a temporary directory, encrypts it with authenticated AES-256-GCM, removes the plaintext even on failure, copies the encrypted result to the required off-machine mount, verifies its size, and applies retention to matching encrypted staging backups only. The daily timer is persistent and uses a randomized delay to avoid every deployment backing up at exactly the same moment. Enable user lingering for the deployment account if timers must run while it is logged out.

## Approved deployment workflow

The `Deploy simulated exchange to staging` GitHub Actions workflow runs only when manually dispatched. Its deployment job starts only after dependency auditing, type checking, building, tests, and Compose validation pass. Configure the GitHub `staging` environment with required reviewers before enabling it.

Add these environment secrets: `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_PRIVATE_KEY`, `STAGING_SSH_KNOWN_HOSTS`, and `STAGING_ENV_FILE`. Store the complete contents of the protected `.env.staging` file in `STAGING_ENV_FILE`. Use a dedicated, minimally privileged deployment account on the host. The known-hosts value must be provisioned out of band; do not collect it automatically during the workflow.

## Stop and inspect

```sh
docker compose --env-file .env.staging -f compose.staging.yml logs --tail=200
docker compose --env-file .env.staging -f compose.staging.yml down
```

Do not add `-v` when stopping unless you deliberately intend to delete the staging database and proxy data.
