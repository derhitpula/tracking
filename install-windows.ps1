# 1-Click-Installer für einen Windows-VPS (nativ, ohne Docker).
# Richtet den Tracker als Autostart-Aufgabe ein (24/7, auch nach Reboot).
# Im Remotedesktop ausführen:  Rechtsklick -> "Mit PowerShell ausführen"
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== Tipp-Tracker (Windows nativ) ==" -ForegroundColor Cyan

# 1) Node vorhanden?
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Write-Host "Node.js fehlt. Bitte installieren: https://nodejs.org (LTS, Version 22 oder neuer)" -ForegroundColor Red
  Write-Host "Danach dieses Skript erneut ausfuehren."
  exit 1
}
$ver = (node -v)
Write-Host "Node gefunden: $ver  ($($node.Source))"

# 2) .env anlegen + API-Key abfragen
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$envText = Get-Content .env -Raw
if ($envText -notmatch '(?m)^APIFOOTBALL_KEY=.+') {
  $key = Read-Host "API-Football Key (Enter = ueberspringen)"
  if ($key) {
    (Get-Content .env) -replace '^APIFOOTBALL_KEY=.*', "APIFOOTBALL_KEY=$key" | Set-Content .env
    Write-Host "Key gespeichert in .env" -ForegroundColor Green
  }
}

# 3) Als geplante Aufgabe registrieren (Start beim Hochfahren, Auto-Neustart)
$taskName = "TippTracker"
$startCmd = Join-Path $PSScriptRoot "start.cmd"

$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$startCmd`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description "Multi-Source Tipp-Tracker" | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host ""
Write-Host "Laeuft 24/7 als Aufgabe '$taskName' (Autostart aktiv)." -ForegroundColor Green
Write-Host "  Dashboard:  http://localhost:8080   (im Browser auf dem VPS oeffnen)"
Write-Host "  Log:        data\scheduler.log"
Write-Host "  Report:     node track.mjs report"
Write-Host "  Stoppen:    Stop-ScheduledTask -TaskName $taskName"
Write-Host "  Entfernen:  Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"
