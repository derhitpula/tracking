// Dauerlauf-Scheduler für den VPS: sammelt periodisch Tipps, holt Ergebnisse
// und betreibt das Dashboard. Ersetzt host-seitiges cron – läuft im Container.
import './lib/env.mjs'; // .env laden (für nativen Betrieb ohne Docker)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './server.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const H = 3600 * 1000;
const COLLECT_EVERY = (Number(process.env.COLLECT_EVERY_HOURS) || 6) * H;
const RESULTS_EVERY = (Number(process.env.RESULTS_EVERY_HOURS) || 1) * H;
// Docker setzt PORT=8080 (intern fix); nativ greift DASHBOARD_PORT aus .env.
const PORT = Number(process.env.PORT || process.env.DASHBOARD_PORT) || 8080;

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function run(cmd) {
  return new Promise((resolve) => {
    console.log(`[${ts()}] ▶ ${cmd}`);
    const p = spawn(process.execPath, [join(DIR, 'track.mjs'), cmd], { stdio: 'inherit' });
    p.on('close', (code) => { console.log(`[${ts()}] ✓ ${cmd} (exit ${code})`); resolve(code); });
    p.on('error', (e) => { console.log(`[${ts()}] ✗ ${cmd}: ${e.message}`); resolve(1); });
  });
}

console.log(`[${ts()}] Scheduler gestartet · daily alle ${COLLECT_EVERY / H}h · enrich+settle alle ${RESULTS_EVERY / H}h`);
console.log(`[${ts()}] API-Football-Key: ${process.env.APIFOOTBALL_KEY ? 'gesetzt' : 'FEHLT (nur TheSportsDB-Fallback)'}`);

// Dashboard standardmäßig AUS (headless). Mit ENABLE_DASHBOARD=true einschaltbar.
if (/^(1|true|yes|on)$/i.test(process.env.ENABLE_DASHBOARD || '')) {
  startServer(PORT);
} else {
  console.log(`[${ts()}] Dashboard deaktiviert (headless). Report via: docker compose exec tracker node track.mjs report`);
}

// Betmonitor täglich um Mitternacht UTC vorwärmen bevor Spiele starten.
// Läuft zusätzlich zum normalen collect, damit frühe australische/asiatische
// Matches immer gecacht sind – unabhängig vom collect-Startzeitpunkt.
function scheduleMidnightPrefetch() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const msUntil = midnight - now;
  console.log(`[${ts()}] Betmonitor-Prefetch um Mitternacht UTC in ${Math.round(msUntil / 60000)} min`);
  setTimeout(() => {
    run('prefetch');
    setInterval(() => run('prefetch'), 24 * H);
  }, msUntil);
}
scheduleMidnightPrefetch();

// Voller Tagesablauf (collect+prune+enrich+odds+settle) periodisch;
// Endstände zusätzlich häufiger nachziehen (enrich+settle).
async function dailyLoop() {
  for (;;) {
    await run('daily');
    await new Promise((r) => setTimeout(r, COLLECT_EVERY));
  }
}
async function resultsLoop() {
  for (;;) {
    await new Promise((r) => setTimeout(r, RESULTS_EVERY));
    await run('enrich');
    await run('settle');
  }
}
dailyLoop();
setTimeout(resultsLoop, 60 * 1000);
