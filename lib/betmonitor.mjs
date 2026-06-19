// Betmonitor.com – Quoten-Fallback für Nischen-Ligen (kein Cloudflare, reines HTML).
// Scrapt /odds-comparison/football/today einmal pro Tag, cached die Ergebnisse.
// Gibt die durchschnittlichen Marktquoten zurück (Best-Odds-Anzeige auf der Listenseite).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { UA } from './fetch.mjs';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'results_cache');
const BASE_URL = 'https://www.betmonitor.com/odds-comparison/football/today';

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function simScore(a, b) {
  const A = clean(a).split(' ').filter(Boolean);
  const B = new Set(clean(b).split(' ').filter(Boolean));
  if (!A.length || !B.size) return 0;
  return A.filter((w) => B.has(w)).length / Math.max(A.length, B.size);
}

function parseEvents(html) {
  const events = [];
  const blocks = html.split('<div class="league-event-new">').slice(1);
  for (const block of blocks) {
    // Teams aus .teams Link extrahieren: "Heim - Gast"
    const tm = block.match(/<div class="teams"><a[^>]+>([^<]+)<\/a>/);
    if (!tm) continue;
    const raw = tm[1].trim();
    // EM-Dash (—) oder normaler Bindestrich als Trenner
    const sep = raw.includes(' — ') ? ' — ' : ' - ';
    const idx = raw.lastIndexOf(sep);
    if (idx === -1) continue;
    const home = raw.slice(0, idx).trim();
    const away = raw.slice(idx + sep.length).trim();

    // Unix-Timestamp → Datum
    const tsM = block.match(/data-timestamp="(\d+)"/);
    const date = tsM ? new Date(parseInt(tsM[1]) * 1000).toISOString().slice(0, 10) : null;

    // 1X2 Quoten aus erstem .odds-Block (Durchschnitts-/Best-Quoten)
    const odds = { '1': null, X: null, '2': null };
    // Ersten .odds-Block isolieren (endet vor zweitem .odds oder .team-logo)
    const oddsStart = block.indexOf('<div class="odds">');
    if (oddsStart !== -1) {
      const oddsEnd = block.indexOf('</div>', oddsStart + 18);
      const oddsHtml = block.slice(oddsStart, oddsEnd + 6);
      for (const [, lbl, val] of oddsHtml.matchAll(/>([1X2]) <span class="odd-decimal[^"]*">(\d+\.\d+)</g)) {
        odds[lbl] = parseFloat(val);
      }
    }

    if (home && away) events.push({ home, away, date, odds });
  }
  return events;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

async function fetchToday() {
  const date = todayIso();
  const file = join(CACHE, `betmonitor_${date}.json`);
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch {} }
  try {
    const html = execFileSync('curl', [
      '-s', '-L', '-A', UA, '-H', 'Accept: text/html', '--max-time', '30', BASE_URL,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (!html || html.length < 1000) return [];
    const events = parseEvents(html);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(events));
    return events;
  } catch { return []; }
}

const FLIP = { '1': '2', '2': '1' };

// Quoten für ein Spiel suchen. Nur sinnvoll wenn match_date ≈ heute.
export async function betmonitorOdds(home, away, date, code) {
  if (!['1', 'X', '2'].includes(code)) return null;
  // Nur für heutige Spiele (betmonitor zeigt nur /today)
  if (date && Math.abs(new Date(date) - new Date(todayIso())) > 2 * 86400 * 1000) return null;
  const events = await fetchToday();
  let best = null, bestScore = 0;
  for (const ev of events) {
    const s = Math.min(simScore(home, ev.home), simScore(away, ev.away));
    const s2 = Math.min(simScore(home, ev.away), simScore(away, ev.home));
    const score = Math.max(s, s2);
    if (score > bestScore) { bestScore = score; best = { ev, swapped: s2 > s }; }
  }
  if (!best || bestScore < 0.45) return null;
  const { ev, swapped } = best;
  const effectiveCode = swapped ? (FLIP[code] ?? code) : code;
  return ev.odds[effectiveCode] ?? null;
}
