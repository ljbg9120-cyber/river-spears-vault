<#
.SYNOPSIS
    Bring the whole site up: server + public HTTPS address.

.DESCRIPTION
    Starts the API and an ngrok tunnel, both detached so they keep running
    after this window closes. Safe to run twice — it replaces whatever was
    already running rather than fighting it.

    Set NGROK_DOMAIN in .env to your reserved ngrok domain and the address
    stops changing between restarts. Without it ngrok hands out a random one.

.EXAMPLE
    .\serve.ps1
    .\serve.ps1 -Install    # also run automatically at every login
#>
[CmdletBinding()]
param(
    [int]$Port = 8020,
    [switch]$Install,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$ngrok = Join-Path $root "tools\ngrok.exe"
$dataDir = Join-Path $root "data"
New-Item -ItemType Directory -Force $dataDir | Out-Null

function Say($text, $colour = "Gray") { if (-not $Quiet) { Write-Host $text -ForegroundColor $colour } }

# --- run at login ----------------------------------------------------------
if ($Install) {
    # A Startup-folder shortcut rather than a scheduled task: registering a
    # task needs administrator rights, and this does not.
    $startup = [Environment]::GetFolderPath("Startup")
    $launcher = Join-Path $startup "RiverSpearsVault.cmd"
    @(
        "@echo off"
        "rem Starts River Spears and the Crews Vault at login."
        "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$PSCommandPath"" -Quiet"
    ) | Set-Content -Path $launcher -Encoding ascii
    Say "Installed: the site now starts automatically when you log in." Green
    Say "Remove it by deleting: $launcher" DarkGray
}

# --- clear anything already running ---------------------------------------
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
foreach ($c in (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Seconds 2

# --- a reserved domain keeps the address stable ---------------------------
$domain = $null
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern "^\s*NGROK_DOMAIN\s*=\s*(.+)$" | Select-Object -First 1
    if ($line) { $domain = $line.Matches[0].Groups[1].Value.Trim() }
}

$ngrokArgs = @("http", "$Port", "--log=stdout")
if ($domain) { $ngrokArgs += "--url=https://$domain" }

$ngrokLog = Join-Path $dataDir "ngrok.log"
Remove-Item $ngrokLog, "$ngrokLog.err" -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $ngrok -ArgumentList $ngrokArgs -WindowStyle Hidden `
    -RedirectStandardOutput $ngrokLog -RedirectStandardError "$ngrokLog.err"

# ngrok publishes the live address on its own local API.
$url = $null
foreach ($i in 1..60) {
    Start-Sleep -Milliseconds 700
    try {
        $tunnels = (Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5).tunnels
        $https = $tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1
        if ($https) { $url = $https.public_url; break }
    } catch { }
}
if (-not $url) {
    Write-Host "The tunnel did not come up. Last output:" -ForegroundColor Red
    Get-Content $ngrokLog, "$ngrokLog.err" -Tail 8 -ErrorAction SilentlyContinue
    exit 1
}

# --- the app needs to know its own address for share links and cookies ----
$lines = @(Get-Content $envFile -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch "^\s*VAULT_PUBLIC_URL\s*=" })
$lines += "VAULT_PUBLIC_URL=$url"
Set-Content -Path $envFile -Value $lines -Encoding utf8

Start-Process -FilePath $python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$Port", `
                  "--proxy-headers", "--forwarded-allow-ips=*" `
    -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDir "server.out") `
    -RedirectStandardError (Join-Path $dataDir "server.log")

$ok = $false
foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 700
    try {
        if ((Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) {
            $ok = $true; break
        }
    } catch { }
}

if (-not $ok) {
    Write-Host "The server did not start. Last output:" -ForegroundColor Red
    Get-Content (Join-Path $dataDir "server.log") -Tail 10 -ErrorAction SilentlyContinue
    exit 1
}

Say ""
Say "  Your site is live at:" DarkGray
Say "  $url" Green
Say ""
if (-not $domain) {
    Say "  This address changes each restart. To fix that, reserve a domain at" DarkGray
    Say "  https://dashboard.ngrok.com/domains and add it to .env as:" DarkGray
    Say "      NGROK_DOMAIN=your-name.ngrok-free.dev" DarkGray
    Say ""
}
