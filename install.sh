#!/usr/bin/env bash
# 1-Click-Installer für den VPS (Linux, Docker).
set -euo pipefail
cd "$(dirname "$0")"

echo "== Tipp-Tracker Installation =="

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker ist nicht installiert."
  echo "   Schnellinstallation: curl -fsSL https://get.docker.com | sh"
  exit 1
fi
docker compose version >/dev/null 2>&1 || { echo "❌ 'docker compose' fehlt (Docker Compose v2 nötig)."; exit 1; }

# .env anlegen
[ -f .env ] || cp .env.example .env

# API-Key abfragen, falls noch leer
if ! grep -q '^APIFOOTBALL_KEY=.\+' .env; then
  read -rp "API-Football Key (Enter = überspringen, nur TheSportsDB-Fallback): " KEY || true
  if [ -n "${KEY:-}" ]; then
    sed -i "s|^APIFOOTBALL_KEY=.*|APIFOOTBALL_KEY=${KEY}|" .env
    echo "✔ Key gespeichert in .env"
  fi
fi

PORT=$(grep '^DASHBOARD_PORT=' .env | cut -d= -f2); PORT=${PORT:-8080}

echo "== Baue & starte Container =="
docker compose up -d --build

echo
echo "✅ Läuft 24/7 (Auto-Restart aktiv)."
echo "   Dashboard:   http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}"
echo "   Logs:        docker compose logs -f"
echo "   Report-CLI:  docker compose exec tracker node track.mjs report"
echo "   Stoppen:     docker compose down"
