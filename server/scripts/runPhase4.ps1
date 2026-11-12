<#
.SYNOPSIS
  Runs the Phase 4 verification against the RUNNING backend and its TEST database (Windows PowerShell 5.1 or PowerShell 7).

.EXAMPLE
  cd server
  .\scripts\runPhase4.ps1 -ConfirmDb aayush_carting_test -OwnerEmail testowner@example.com -IUnderstandThisWritesTestData -SetTestSettings

  The owner password is asked for (hidden) when OWNER_PASSWORD is not already set. Nothing is hardcoded, nothing secret is printed,
  and the password variables are removed from this session afterwards.
  Exit codes: 0 all performed checks passed | 1 a check failed | 2 safety stop or bad input | 3 infrastructure problem / uncertain outcome.
  There is deliberately no switch that allows a non-TEST database: verifyPhase4.js enforces the "_test" rule itself.
#>
[CmdletBinding()]
param(
  [string]$ConfirmDb,
  [string]$OwnerEmail,
  [string]$ApiBase = "http://localhost:5000/api",
  [switch]$IUnderstandThisWritesTestData,
  [switch]$SetTestSettings
)

$ErrorActionPreference = "Stop"
$serverDir = Split-Path -Parent $PSScriptRoot
$touched = @("PHASE4_CONFIRM_DB", "OWNER_EMAIL", "OWNER_PASSWORD", "API_BASE")

function Invoke-Phase4 {
$exitCode = 2
try {
  if (-not $IUnderstandThisWritesTestData) {
    Write-Host "STOP: this writes test records (names start with 'ZZ P4') into the TEST database. Add -IUnderstandThisWritesTestData to continue." -ForegroundColor Red
    return 2
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "STOP: Node.js was not found on PATH." -ForegroundColor Red; return 2 }
  if (-not (Test-Path (Join-Path $serverDir "scripts\verifyPhase4.js"))) { Write-Host "STOP: scripts\verifyPhase4.js not found next to this launcher." -ForegroundColor Red; return 2 }

  # A connection string left in this window beats server\.env, so the script could use a different database than the file shows.
  if ($env:MONGODB_URI) {
    Write-Host "NOTE: MONGODB_URI was set in this PowerShell window; removing it for this session so that server\.env is the only source."
    Remove-Item Env:MONGODB_URI -ErrorAction SilentlyContinue
  }
  if ($env:NODE_ENV -and $env:NODE_ENV.ToLower() -eq "production") { Write-Host "STOP: NODE_ENV is production in this window." -ForegroundColor Red; return 2 }

  if (-not $ConfirmDb) { $ConfirmDb = Read-Host "Type the exact TEST database name to confirm (must end with _test)" }
  if ($ConfirmDb -notmatch "_test$") { Write-Host "STOP: '$ConfirmDb' does not end with _test." -ForegroundColor Red; return 2 }
  if (-not $OwnerEmail) { $OwnerEmail = Read-Host "TEST owner email" }
  if (-not $OwnerEmail) { Write-Host "STOP: owner email is required." -ForegroundColor Red; return 2 }

  # 1. Is the backend reachable, and is it on the confirmed TEST database? (read-only GET /health, no login)
  $base = $ApiBase.TrimEnd("/")
  try {
    $health = Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 10
  } catch {
    Write-Host "STOP: the backend did not answer GET $base/health. Start it first in another window: cd server; npm run dev" -ForegroundColor Red
    Write-Host "      ($($_.Exception.Message))"
    return 3
  }
  $reportedDb = $health.data.database.name
  Write-Host "Backend answers. Environment: $($health.data.environment). Database: $reportedDb"
  if ($health.data.environment -eq "production") { Write-Host "STOP: the backend reports production mode." -ForegroundColor Red; return 2 }
  if ($reportedDb -ne $ConfirmDb) { Write-Host "STOP: the backend is connected to '$reportedDb', not the confirmed TEST database '$ConfirmDb'." -ForegroundColor Red; return 2 }

  # 2. Password: hidden prompt unless already provided in the environment.
  if (-not $env:OWNER_PASSWORD) {
    $secure = Read-Host "Password for $OwnerEmail" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  if (-not $env:OWNER_PASSWORD) { Write-Host "STOP: a password is required." -ForegroundColor Red; return 2 }

  $env:PHASE4_CONFIRM_DB = $ConfirmDb
  $env:OWNER_EMAIL = $OwnerEmail
  $env:API_BASE = $base

  # 3. Run (from the server folder, so server\.env is the one used).
  $nodeArgs = @("scripts\verifyPhase4.js", "--i-understand-this-writes-test-data")
  if ($SetTestSettings) { $nodeArgs += "--set-test-settings" }
  Push-Location $serverDir
  try {
    & node @nodeArgs | Out-Host
    $exitCode = $LASTEXITCODE
  } finally { Pop-Location }

  switch ($exitCode) {
    0 { Write-Host "`nRESULT: every check that was performed passed. (Read the report above for any SKIPPED checks.)" -ForegroundColor Green }
    1 { Write-Host "`nRESULT: at least one check FAILED. See the FAILED list above." -ForegroundColor Red }
    2 { Write-Host "`nRESULT: the script refused to start (safety gate or missing input). Nothing was written." -ForegroundColor Red }
    3 { Write-Host "`nRESULT: INCONCLUSIVE (infrastructure problem or an uncertain request). This is not an application failure; read the message above." -ForegroundColor Yellow }
    default { Write-Host "`nRESULT: unexpected exit code $exitCode." -ForegroundColor Red }
  }
  return $exitCode
} finally {
  foreach ($name in $touched) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
}
}

exit (Invoke-Phase4)
