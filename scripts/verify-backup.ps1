$ErrorActionPreference = "Stop"

$restoreDatabase = "exchange_verify_" + ([Guid]::NewGuid().ToString("N").Substring(0, 12))
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$backupFile = Join-Path $tempRoot ("nexa-backup-" + [Guid]::NewGuid().ToString("N") + ".sql")
$backupPath = [IO.Path]::GetFullPath($backupFile)

if ([IO.Path]::GetDirectoryName($backupPath) + [IO.Path]::DirectorySeparatorChar -ne $tempRoot) {
  throw "Temporary backup path resolved outside the system temporary directory."
}
if ($restoreDatabase -notmatch '^exchange_verify_[a-f0-9]{12}$') {
  throw "Temporary database name failed validation."
}

function Invoke-DockerDatabaseCommand {
  param([string[]]$Arguments)
  $output = & docker compose exec -T postgres @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker database command failed: $($Arguments -join ' ')" }
  return $output
}

try {
  Write-Host "Creating a consistent backup of exchange_demo..."
  $dump = Invoke-DockerDatabaseCommand @("pg_dump", "-U", "exchange", "--no-owner", "--no-privileges", "exchange_demo")
  [IO.File]::WriteAllLines($backupPath, [string[]]$dump, [Text.UTF8Encoding]::new($false))
  if ((Get-Item -LiteralPath $backupPath).Length -lt 100) { throw "Backup output was unexpectedly small." }

  Write-Host "Restoring into isolated database $restoreDatabase..."
  Invoke-DockerDatabaseCommand @("createdb", "-U", "exchange", $restoreDatabase) | Out-Null
  Get-Content -LiteralPath $backupPath -Raw | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U exchange -d $restoreDatabase | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Restore failed." }

  $tableCount = Invoke-DockerDatabaseCommand @("psql", "-U", "exchange", "-d", $restoreDatabase, "-tA", "-c", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
  if ([int]($tableCount | Select-Object -Last 1) -lt 8) { throw "Restored database is missing expected tables." }

  $imbalancedAssets = Invoke-DockerDatabaseCommand @("psql", "-U", "exchange", "-d", $restoreDatabase, "-tA", "-c", "SELECT count(*) FROM (SELECT la.asset FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.ledger_account_id GROUP BY la.asset HAVING SUM(CASE WHEN le.direction='CREDIT' THEN le.amount ELSE -le.amount END) <> 0) broken;")
  if ([int]($imbalancedAssets | Select-Object -Last 1) -ne 0) { throw "Restored ledger invariant failed." }

  Write-Host "Backup verification passed: restore succeeded, expected tables exist, and the ledger balances."
} finally {
  Write-Host "Removing isolated verification resources..."
  & docker compose exec -T postgres dropdb -U exchange --if-exists $restoreDatabase | Out-Null
  if (Test-Path -LiteralPath $backupPath) { Remove-Item -LiteralPath $backupPath -Force }
}
