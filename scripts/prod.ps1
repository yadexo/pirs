<#
.SYNOPSIS
Runs one database task against the production database.

.DESCRIPTION
Asks for the connection string once (hidden), shows which database it is about
to touch, waits for confirmation, runs the task, and clears the connection
string afterwards. Nothing is written to disk, so there is no file to remember
to delete and nothing that could be committed by accident.

.EXAMPLE
  npm run prod:status                         # read-only: what is pending?
  npm run prod:migrate                        # apply pending migrations
  npm run prod:admin -- --email you@you.com   # create the first platform admin
  npm run prod:reset-admin -- --email you@you.com
  npm run prod:client -- --clinic testclinic --email client@you.com

.PARAMETER Task
status | migrate | admin | reset-admin | client

.PARAMETER Url
The connection string, for automation. Prefer the prompt: an argument is saved
in your PowerShell history.

.PARAMETER Yes
Skip the confirmation. Intended for scripts, not for day-to-day use.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("status", "migrate", "admin", "reset-admin", "client")]
  [string]$Task = "status",

  [string]$Url,
  [switch]$Yes,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Use Neon's direct connection string (the host without "-pooler"): migrations
# take a lock that a pooled connection can fail on.
if (-not $Url) {
  $secure = Read-Host "Production connection string (input hidden)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $Url = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$Url = $Url.Trim()
if (-not $Url) { Write-Host "No connection string given. Nothing was run." -ForegroundColor Yellow; exit 1 }
if ($Url -notmatch '^postgres(ql)?://') {
  Write-Host "That doesn't look like a Postgres connection string. Nothing was run." -ForegroundColor Yellow
  exit 1
}

# Show enough to recognise the database, never the password.
$parsed = [Uri]$Url
$target = "$($parsed.Host) / $($parsed.AbsolutePath.TrimStart('/'))"

$commands = @{
  "status"       = @("npx", "prisma", "migrate", "status")
  "migrate"      = @("npx", "prisma", "migrate", "deploy")
  "admin"        = @("npx", "tsx", "prisma/create-platform-admin.ts")
  "reset-admin"  = @("npx", "tsx", "prisma/reset-platform-admin-password.ts")
  "client"       = @("npx", "tsx", "prisma/create-client-login.ts")
}
$command = $commands[$Task]
$exe = $command[0]
# npm passes extra arguments through, so `npm run prod:client -- --clinic x` works.
$commandArgs = @($command[1..($command.Length - 1)]) + @($Rest | Where-Object { $_ })

$readOnly = $Task -eq "status"
Write-Host ""
Write-Host "Task:     $Task" -ForegroundColor Cyan
Write-Host "Database: $target" -ForegroundColor Cyan
if (-not $readOnly -and -not $Yes) {
  $answer = Read-Host 'Type "yes" to continue'
  if ($answer.Trim().ToLower() -ne "yes") { Write-Host "Cancelled. Nothing was changed."; exit 1 }
}

try {
  $env:DATABASE_URL = $Url
  & $exe @commandArgs
  $code = $LASTEXITCODE
} finally {
  # The connection string never outlives this script, even on Ctrl+C.
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  $Url = $null
  [GC]::Collect()
}

if ($code -ne 0) { Write-Host "`nThat task failed (exit $code)." -ForegroundColor Yellow }
exit $code
