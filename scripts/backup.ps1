$ErrorActionPreference = "Stop"

$backupDir = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $backupDir "exchange-demo-$timestamp.sql"

# Plain SQL output is intentionally used so PowerShell can safely write it as
# text. The database remains online while PostgreSQL creates this consistent
# logical backup.
docker compose exec -T postgres pg_dump -U exchange exchange_demo | Set-Content -Encoding utf8 -Path $backupFile

if ((Get-Item $backupFile).Length -eq 0) {
  Remove-Item -LiteralPath $backupFile
  throw "Backup output was empty. Confirm Docker Desktop and the postgres service are running."
}

Write-Host "Backup created: $backupFile"
