<#
.SYNOPSIS
    Run Vault.

.EXAMPLE
    .\run.ps1 -Setup     # install backend + frontend dependencies
    .\run.ps1 -Dev       # API on :8000 and Vite on :5173 (hot reload)
    .\run.ps1            # build the frontend, then serve everything from :8000
#>
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Dev,
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

function Assert-Venv {
    if (-not (Test-Path $python)) {
        Write-Host "Creating virtual environment..." -ForegroundColor Cyan
        python -m venv (Join-Path $root ".venv")
    }
}

if ($Setup) {
    Assert-Venv
    Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
    & $python -m pip install --upgrade pip
    & $python -m pip install -r (Join-Path $root "backend\requirements.txt")

    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Push-Location (Join-Path $root "frontend")
    npm install
    Pop-Location

    Write-Host "`nSetup complete. Start it with: .\run.ps1 -Dev" -ForegroundColor Green
    return
}

Assert-Venv

if ($Dev) {
    Write-Host "API      -> http://localhost:$Port" -ForegroundColor Cyan
    Write-Host "Frontend -> http://localhost:5173" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop both.`n" -ForegroundColor DarkGray

    $api = Start-Process -FilePath $python -PassThru -NoNewWindow `
        -WorkingDirectory (Join-Path $root "backend") `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--port", $Port

    try {
        Push-Location (Join-Path $root "frontend")
        npm run dev
    }
    finally {
        Pop-Location
        if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force }
    }
    return
}

# Production-ish: build the SPA, then let FastAPI serve it on one port.
Write-Host "Building frontend..." -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
npm run build
Pop-Location

Write-Host "`nVault -> http://localhost:$Port" -ForegroundColor Green
Push-Location (Join-Path $root "backend")
try {
    & $python -m uvicorn app.main:app --host 0.0.0.0 --port $Port
}
finally {
    Pop-Location
}
