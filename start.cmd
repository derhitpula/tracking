@echo off
REM Startet den Tracker-Scheduler (Windows, nativ ohne Docker).
cd /d "%~dp0"
if not exist data mkdir data
node scheduler.mjs >> data\scheduler.log 2>&1
