# 1-Click-Installer für einen Windows-VPS mit Docker Desktop.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== Tipp-Tracker Installation ==" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker ist nicht installiert. Bitte Docker Desktop installieren." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path .env)) { Copy-Item .env.example .env }

$env_content = Get-Content .env -Raw
if ($env_content -notmatch '(?m)^APIFOOTBALL_KEY=.+') {
  $key = Read-Host "API-Football Key (Enter = ueberspringen)"
  if ($key) {
    (Get-Content .env) -replace '^APIFOOTBALL_KEY=.*', "APIFOOTBALL_KEY=$key" | Set-Content .env
    Write-Host "Key gespeichert in .env" -ForegroundColor Green
  }
}

$port = ((Get-Content .env | Where-Object { $_ -match '^DASHBOARD_PORT=' }) -split '=')[1]
if (-not $port) { $port = "8080" }

Write-Host "== Baue & starte Container ==" -ForegroundColor Cyan
docker compose up -d --build

Write-Host ""
Write-Host "Laeuft 24/7 (Auto-Restart aktiv)." -ForegroundColor Green
Write-Host "  Dashboard:  http://localhost:$port"
Write-Host "  Logs:       docker compose logs -f"
Write-Host "  Report:     docker compose exec tracker node track.mjs report"
Write-Host "  Stoppen:    docker compose down"
