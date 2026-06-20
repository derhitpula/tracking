@echo off
REM Startet den Tracker-Scheduler (Windows, nativ ohne Docker).
REM Faehrt daily periodisch, zieht Ergebnisse stuendlich nach und hostet das Dashboard.
cd /d "%~dp0"
if not exist data mkdir data
set ENABLE_DASHBOARD=true
node scheduler.mjs >> data\scheduler.log 2>&1
