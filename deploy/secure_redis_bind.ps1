#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Bind the Windows Redis service to localhost only (127.0.0.1).

.DESCRIPTION
  - Backs up redis.windows-service.conf before editing
  - Enables: bind 127.0.0.1
  - Preserves existing requirepass (does not clear/change the password)
  - Restarts only the Redis Windows service
  - Does NOT modify Windows Firewall rules
  - Does NOT change Django/Celery application code

.NOTES
  Run from an Administrator PowerShell:
    powershell -ExecutionPolicy Bypass -File .\deploy\secure_redis_bind.ps1
#>

$ErrorActionPreference = "Stop"

$conf = "C:\Program Files\Redis\redis.windows-service.conf"
$serviceName = "Redis"

if (-not (Test-Path $conf)) {
  throw "Redis service config not found: $conf"
}

$svc = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if (-not $svc) { throw "Windows service '$serviceName' not found." }
if ($svc.PathName -notmatch [regex]::Escape($conf)) {
  throw "Service PathName does not reference expected config.`nPathName=$($svc.PathName)`nExpected conf=$conf"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$conf.bak-$stamp"
Copy-Item -LiteralPath $conf -Destination $backup -Force
Write-Host "Backup written: $backup"

# Capture requirepass before edit (must survive rewrite).
$before = Get-Content -LiteralPath $conf
$requireLine = $before | Where-Object { $_ -match '^\s*requirepass\s+' } | Select-Object -Last 1
if (-not $requireLine) {
  Write-Warning "No requirepass found in config. Binding will still proceed; set a password afterward."
} else {
  Write-Host "Preserving: $($requireLine -replace '(requirepass\s+).+','`$1***')"
}

$content = Get-Content -LiteralPath $conf -Raw

# Remove any active bind lines, then set localhost-only bind.
$content = [regex]::Replace($content, '(?m)^\s*bind\s+.+\r?\n', '')
if ($content -match '(?m)^#\s*bind 127\.0\.0\.1\s*$') {
  $content = [regex]::Replace($content, '(?m)^#\s*bind 127\.0\.0\.1\s*$', 'bind 127.0.0.1')
} else {
  # Insert near the top commented bind section if present; else prepend.
  if ($content -match '(?m)^# bind 192\.168\.1\.100') {
    $content = $content -replace '(?m)^(# bind 192\.168\.1\.100[^\r\n]*\r?\n)', "bind 127.0.0.1`r`n`$1"
  } else {
    $content = "bind 127.0.0.1`r`n" + $content
  }
}

# Ensure requirepass line still present after edits.
if ($requireLine -and ($content -notmatch '(?m)^\s*requirepass\s+')) {
  $content = $content.TrimEnd() + "`r`n`r`n$requireLine`r`n"
}

Set-Content -LiteralPath $conf -Value $content -Encoding ASCII
Write-Host "Updated bind directive in: $conf"

Restart-Service -Name $serviceName -Force
Write-Host "Redis service restarted."
Start-Sleep -Seconds 2

Write-Host "`nListening sockets for :6379:"
netstat -ano | findstr "LISTENING" | findstr ":6379"

$listen = netstat -ano | findstr "LISTENING" | findstr ":6379"
$bad = @(
  $listen | Where-Object {
    ($_ -match '0\.0\.0\.0:6379') -or ($_ -match '\[::\]:6379')
  }
)
$good = @($listen | Where-Object { $_ -match '127\.0\.0\.1:6379' })

if ($bad.Count -gt 0) {
  Write-Host "FAIL: still listening on all-interfaces:" -ForegroundColor Red
  $bad | ForEach-Object { Write-Host $_ }
  exit 1
}
if ($good.Count -eq 0) {
  Write-Host "FAIL: 127.0.0.1:6379 not listening." -ForegroundColor Red
  exit 1
}

Write-Host "OK: Redis is listening on 127.0.0.1:6379 only." -ForegroundColor Green

# Optional result file for non-interactive verification after elevation.
$resultFile = Join-Path $env:TEMP "bizmanager-redis-bind-result.txt"
@(
  "timestamp=$(Get-Date -Format o)"
  "status=OK"
  "backup=$backup"
  "listen="
  $listen
) | Set-Content -LiteralPath $resultFile -Encoding UTF8
Write-Host "Result file: $resultFile"
exit 0
