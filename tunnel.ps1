<#
.SYNOPSIS
    Put Vault on the public internet through a Cloudflare quick tunnel.

.DESCRIPTION
    Builds the site, opens a tunnel, points the app at whatever public address
    the tunnel hands out, and starts the server. Anyone with the printed link
    can open Vault and sign up.

    The address changes every time you run this -- that is how free quick
    tunnels work. Links you shared from a previous run stop resolving.

    Ctrl+C stops both the tunnel and the server.

.EXAMPLE
    .\tunnel.ps1
    .\tunnel.ps1 -SkipBuild    # reuse the existing frontend build
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$cloudflared = Join-Path $root "tools\cloudflared.exe"
$envFile = Join-Path $root ".env"

if (-not (Test-Path $python)) { throw "No virtualenv. Run .\run.ps1 -Setup first." }

if (-not (Test-Path $cloudflared)) {
    Write-Host "Downloading cloudflared..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force (Join-Path $root "tools") | Out-Null
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cloudflared
}

if (-not $SkipBuild) {
    Write-Host "Building the site..." -ForegroundColor Cyan
    Push-Location (Join-Path $root "frontend")
    try { npm run build } finally { Pop-Location }
}

# --- open the tunnel and wait for it to name itself ------------------------
$log = Join-Path $env:TEMP "vault-tunnel-$PID.log"
if (Test-Path $log) { Remove-Item $log -Force }

Write-Host "Opening the tunnel..." -ForegroundColor Cyan
$tunnel = Start-Process -FilePath $cloudflared -PassThru -NoNewWindow `
    -ArgumentList "tunnel", "--url", "http://localhost:$Port", "--no-autoupdate" `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out"

$publicUrl = $null
foreach ($attempt in 1..60) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $log) {
        $match = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
                 Select-Object -First 1
        if ($match) { $publicUrl = $match.Matches[0].Value; break }
    }
}

if (-not $publicUrl) {
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
    throw "The tunnel never reported a URL. Check $log"
}

# --- point the app at that address ----------------------------------------
# Share links and the Secure-cookie decision both read VAULT_PUBLIC_URL, so it
# has to match the address people actually type.
if (Test-Path $envFile) {
    $lines = Get-Content $envFile | Where-Object { $_ -notmatch "^\s*VAULT_PUBLIC_URL\s*=" }
}
else {
    $secret = & $python -c "import secrets; print(secrets.token_urlsafe(48))"
    $lines = @(
        "# Vault runtime configuration. Never commit this file.",
        "VAULT_SECRET_KEY=$secret",
        "VAULT_MAX_UPLOAD_MB=200",
        "VAULT_GOOGLE_CLIENT_ID="
    )
}
$lines += "VAULT_PUBLIC_URL=$publicUrl"
Set-Content -Path $envFile -Value $lines -Encoding utf8

Write-Host ""
Write-Host "  Vault is live at:" -ForegroundColor DarkGray
Write-Host "  $publicUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  Anyone with that link can open it and sign up." -ForegroundColor DarkGray
Write-Host "  It stays up while this window is open. Ctrl+C stops it." -ForegroundColor DarkGray
Write-Host ""

try {
    Push-Location (Join-Path $root "backend")
    & $python -m uvicorn app.main:app --host 127.0.0.1 --port $Port `
        --proxy-headers --forwarded-allow-ips="*"
}
finally {
    Pop-Location
    if ($tunnel -and -not $tunnel.HasExited) {
        Write-Host "`nClosing the tunnel..." -ForegroundColor DarkGray
        Stop-Process -Id $tunnel.Id -Force
    }
}
