# Local Operations Guide

This guide applies only to the simulated local demo. It is not a production disaster-recovery plan.

## Start the local services

Keep Docker Desktop running, then from the project folder run:

```powershell
docker compose up -d
```

Run the website and API in separate terminals:

```powershell
npm.cmd run dev
```

```powershell
npm.cmd run dev:api
```

## Health checks

Open these URLs in a browser:

- `http://localhost:3001/api/health` — API process is running.
- `http://localhost:3001/api/ready` — API can query PostgreSQL.

Detailed session-rotation statistics are intentionally not public. Administrators can access them through the authenticated `/api/admin/session-health` route; use the protected metrics endpoint for external monitoring.

## Safe restarts

Press `Ctrl+C` once to stop the combined development server. The API first stops reporting itself as ready, closes live browser event streams, finishes active HTTP requests, and then closes Redis and PostgreSQL connections. A forced shutdown occurs after 10 seconds if an active request cannot finish.

## Backup

Create a timestamped database backup:

```powershell
npm.cmd run backup
```

Backups are written to the `backups` folder, which is ignored by Git. Keep copies somewhere secure if the demo data matters.

## Authenticator encryption key

Local development creates `.local-secrets/data-encryption.key` automatically. Authenticator setup secrets in PostgreSQL are encrypted with this key. Store a protected copy of the key separately from database backups; a restored database cannot validate authenticator codes without the same key.

Production must provide `DATA_ENCRYPTION_KEY` as a base64-encoded 32-byte secret through its secret manager. Never commit this key or copy it into application logs.

The same key protects short-lived verification/reset codes and recovery codes with keyed HMAC hashes. When upgrading an older database, legacy unkeyed code hashes are deleted because they cannot be secured without the original codes. Users may need to request a fresh email/reset code, and users relying on recovery codes should generate a new set after signing in with their authenticator.

## Restore drill

Run the automated, isolated restore verification:

```powershell
npm.cmd run verify:backup
```

This creates a backup in the system temporary folder, restores it into a randomly named temporary database, checks the expected tables and whole-ledger balance invariant, then removes both temporary resources. It never restores over `exchange_demo`.

For a manual drill, use the steps below.

Restoring a backup into the existing database can overwrite or conflict with current demo data. First create a separate restore database from a Command Prompt:

```cmd
docker compose exec -T postgres createdb -U exchange exchange_restore
```

Then import a chosen backup (replace the filename):

```cmd
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U exchange -d exchange_restore < backups\exchange-demo-YYYYMMDD-HHMMSS.sql
```

Verify the restored database contains the expected tables:

```cmd
docker compose exec -T postgres psql -U exchange -d exchange_restore -c "\dt"
```

Do not restore into `exchange_demo` unless you deliberately intend to replace local demo data.

## Transactional email

Local development shows verification and password-reset codes in the browser. Production refuses to start with the local mock provider or an incomplete real provider configuration. A generic provider requires `EMAIL_API_URL`, `EMAIL_API_KEY`, and `EMAIL_FROM`; its endpoint receives a JSON POST containing `from`, `to`, `subject`, and `text`, authenticated with `Authorization: Bearer <EMAIL_API_KEY>`. Production API responses never contain verification or reset codes.

## HTTPS and reverse proxy

Production requires `TRUST_PROXY=1` and must run behind a trusted reverse proxy that terminates HTTPS and sets the forwarded-protocol header. Plain-HTTP production requests are rejected. Responses include a restrictive content security policy, clickjacking protection, MIME-sniffing protection, a permissions policy, and HSTS in production. Do not expose port 3001 directly to the public internet.

## Session lifetime

Browser sessions use only the HttpOnly session cookie; the legacy bearer-token compatibility path has been removed. Sessions have a 12-hour absolute lifetime and expire after 30 minutes without activity. Activity timestamps are written at most once every five minutes to avoid unnecessary database load.

## External monitoring

Production requires a dedicated `MONITORING_TOKEN`. Configure the external Prometheus-compatible collector to scrape `https://<staging-host>/metrics` with `Authorization: Bearer <MONITORING_TOKEN>`. The endpoint returns 404 when the token is absent or incorrect. Import `monitoring/alerts.yml` into the external alert manager. Keep metrics storage and notifications outside the application host so an application-host failure can still trigger an alert.

## Encrypted off-machine backups

Set `BACKUP_ENCRYPTION_KEY` to an independent base64-encoded 32-byte key, optionally set `OFFSITE_BACKUP_DIRECTORY` to an existing synced or mounted off-machine directory, then run `npm.cmd run backup:encrypted`. The temporary plaintext dump is removed even when encryption fails. Local encrypted backups default to 14-day retention; change this with `BACKUP_RETENTION_DAYS`. Keep the encryption key in a separate secret manager, never beside the backup.

To decrypt a selected backup into a new file, run `node scripts/backup-crypto.mjs decrypt <backup.sql.enc> <restored.sql>`, then follow the isolated restore-drill procedure. The decrypt command refuses to overwrite an existing output and authenticated encryption rejects a modified or incorrect-key backup. Delete decrypted plaintext immediately after the restore drill.
