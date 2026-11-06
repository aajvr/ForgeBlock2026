# Start the ForgeBlock data collection tool for an in-person session.
# Put this file in the collector\ folder and run it from PowerShell:
#     cd path\to\forgeblock\collector
#     .\start-collector.ps1
# (If Windows blocks it: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Use the backend's virtual environment (it has fastapi, uvicorn, opencv).
$venv = Join-Path $PSScriptRoot "..\backend\.venv\Scripts\Activate.ps1"
if (Test-Path $venv) { . $venv } else { Write-Host "Backend .venv not found; using the current Python." -ForegroundColor Yellow }

# Ask for the researcher key so it is never saved in a file or in history.
if (-not $env:COLLECTOR_KEY) {
    $secure = Read-Host "Researcher key (passphrase)" -AsSecureString
    $env:COLLECTOR_KEY = [System.Net.NetworkCredential]::new("", $secure).Password
}

# Show the address(es) the iPad should open.
Write-Host ""
Write-Host "Open one of these in Safari on the iPad (same Wi-Fi or hotspot):" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    ForEach-Object { Write-Host ("   http://{0}:8100   ({1})" -f $_.IPAddress, $_.InterfaceAlias) }
Write-Host ""
Write-Host "Press Ctrl+C to stop when the session is over." -ForegroundColor Cyan
Write-Host ""

uvicorn app:app --host 0.0.0.0 --port 8100
