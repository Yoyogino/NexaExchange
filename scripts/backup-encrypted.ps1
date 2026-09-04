$ErrorActionPreference = "Stop"
if (-not $env:BACKUP_ENCRYPTION_KEY) { throw "Set BACKUP_ENCRYPTION_KEY to a base64-encoded 32-byte key." }
$backupDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\backups"))
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$plain = Join-Path $backupDir "exchange-demo-$timestamp.sql"
$encrypted = Join-Path $backupDir "exchange-demo-$timestamp.sql.enc"
try {
  docker compose exec -T postgres pg_dump -U exchange --no-owner --no-privileges exchange_demo | Set-Content -Encoding utf8 -LiteralPath $plain
  if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $plain).Length -lt 100) { throw "Database backup failed or was unexpectedly small." }
  node (Join-Path $PSScriptRoot "backup-crypto.mjs") encrypt $plain $encrypted
  if ($LASTEXITCODE -ne 0) { throw "Backup encryption failed." }
} finally {
  if (Test-Path -LiteralPath $plain) { Remove-Item -LiteralPath $plain -Force }
}
if ($env:OFFSITE_BACKUP_DIRECTORY) {
  $offsite = [IO.Path]::GetFullPath($env:OFFSITE_BACKUP_DIRECTORY)
  if (-not (Test-Path -LiteralPath $offsite -PathType Container)) { throw "OFFSITE_BACKUP_DIRECTORY must already exist." }
  Copy-Item -LiteralPath $encrypted -Destination $offsite
}
$retentionDays = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 14 }
if ($retentionDays -lt 1) { throw "BACKUP_RETENTION_DAYS must be at least 1." }
Get-ChildItem -LiteralPath $backupDir -Filter "exchange-demo-*.sql.enc" -File | Where-Object LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-$retentionDays) | Remove-Item -Force
Write-Host "Encrypted backup created: $encrypted"
