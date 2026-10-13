<#
.SYNOPSIS
Runs one database task against the staging database.

.DESCRIPTION
The staging twin of prod.ps1 — same safety shape (asks for the connection
string once, hidden; nothing is written to disk), plus one extra guard this
one needs and prod.ps1 doesn't: it refuses outright if the connection string
it is given is the production database, because staging tasks include
wipe, which deletes every row in every table.

.EXAMPLE
  npm run stg:status                          # what is pending?
  npm run stg:migrate                         # apply pending migrations
  npm run stg:wipe                            # empty every table (schema stays)
  npm run stg:seed                            # put test clinics and clients back
  npm run stg:admin -- --email you@you.com    # create the first platform admin
  npm run stg:client -- --clinic testclinic --email client@you.com

.PARAMETER Task
status | migrate | wipe | seed | stripe | apple-pay | items | admin | reset-admin | client | clinic-login | push-debug | membership-debug

.PARAMETER Url
The connection string, for automation. Prefer the prompt: an argument is saved
in your PowerShell history.

.PARAMETER Yes
Skip the confirmation. Intended for scripts, not for day-to-day use.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("status", "migrate", "wipe", "seed", "stripe", "apple-pay", "items", "admin", "reset-admin", "client", "clinic-login", "push-debug", "membership-debug")]
  [string]$Task = "status",

  [string]$Url,
  [switch]$Yes,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# The known production Neon endpoint. A staging task — wipe above all — must
# never be able to reach it, confirmation prompt or not.
$ProductionHostMarker = "ep-frosty-cloud-zal3mzce"

# Use Neon's direct connection string (the host without "-pooler"): migrations
# take a lock that a pooled connection can fail on.
if (-not $Url) {
  $secure = Read-Host "Staging connection string (input hidden)" -AsSecureString
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
if ($Url -match [regex]::Escape($ProductionHostMarker)) {
  Write-Host "That is the production database. Refusing to run a staging task against it." -ForegroundColor Red
  exit 1
}

# Show enough to recognise the database, never the password.
$parsed = [Uri]$Url
$target = "$($parsed.Host) / $($parsed.AbsolutePath.TrimStart('/'))"

$commands = @{
  "status"       = @("npx", "prisma", "migrate", "status")
  "migrate"      = @("npx", "prisma", "migrate", "deploy")
  "wipe"         = @("npx", "tsx", "prisma/wipe-staging-data.ts")
  "seed"         = @("npx", "tsx", "prisma/seed.ts")
  "stripe"       = @("npx", "tsx", "prisma/stripe-account-status.ts")
  "apple-pay"    = @("npx", "tsx", "prisma/register-apple-pay-domains.ts")
  "items"        = @("npx", "tsx", "prisma/create-redeemable-items.ts")
  "admin"        = @("npx", "tsx", "prisma/create-platform-admin.ts")
  "reset-admin"  = @("npx", "tsx", "prisma/reset-platform-admin-password.ts")
  "client"       = @("npx", "tsx", "prisma/create-client-login.ts")
  "clinic-login" = @("npx", "tsx", "prisma/clinic-login.ts")
  "push-debug"   = @("npx", "tsx", "prisma/push-debug.ts")
  "membership-debug" = @("npx", "tsx", "prisma/membership-debug.ts")
}
$command = $commands[$Task]
$exe = $command[0]
# npm passes extra arguments through, so `npm run stg:client -- --clinic x` works.
$commandArgs = @($command[1..($command.Length - 1)]) + @($Rest | Where-Object { $_ })

# "stripe" only writes when asked to store what Stripe says. "wipe" and "seed"
# have their own confirmation prompts (wipe's can't be skipped with -Yes at
# all — see prisma/wipe-staging-data.ts), so this script doesn't double them up.
$readOnly = $Task -in @("status", "push-debug", "membership-debug", "wipe", "seed") -or ($Task -eq "stripe" -and -not ($Rest -contains "--sync"))
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
