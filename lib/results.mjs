// Ergebnis-Engine: liefert für einen Tipp den Endstand {ft:[h,a], ht, src}.
//
// Strategie:
//   - Hat der Adapter eine eigene resolveResult (z. B. BetMines Match-Seiten),
//     wird die zuerst versucht.
//   - Sonst: unabhängige Ergebnis-API. API-Football (Key via Umgebungsvariable
//     APIFOOTBALL_KEY) als Hauptquelle, TheSportsDB (keyless) als Fallback.
//
// Antworten werden pro Tag/Provider auf Platte gecacht, um API-Limits zu schonen.
// -----------------------------------------------------------------------------
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UA } from './fetch.mjs';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'results_cache');
const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY || '';
const SPORTSDB_KEY = process.env.THESPORTSDB_KEY || '3'; // 3 = öffentlicher Test-Key

// --- Teamnamen-Normalisierung & Fuzzy-Vergleich -----------------------------
// nur generische Vereins-Suffixe als Stoppwörter (NICHT united/city -> die
// unterscheiden Teams wie Man United vs Man City)
const STOP = new Set(['fc', 'sc', 'afc', 'cf', 'ac', 'fk', 'sk', 'if', 'bk', 'cd', 'ud', 'club', 'the', 'calcio']);
// Mehrsprachige/abgekürzte Nationen auf einen kanonischen Namen bringen
const NAMEALIAS = {
  usa: 'united states', 'vereinigte staaten': 'united states', 'etats unis': 'united states',
  'korea republic': 'south korea', korea: 'south korea', sudkorea: 'south korea',
  'cote d ivoire': 'ivory coast', elfenbeinkuste: 'ivory coast',
  marokko: 'morocco', schottland: 'scotland', australien: 'australia',
  deutschland: 'germany', spanien: 'spain', 'saudi arabien': 'saudi arabia',
  turkei: 'turkey', turkiye: 'turkey', tschechien: 'czech republic',
  niederlande: 'netherlands',
};
const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function tokens(name) {
  let c = clean(name); c = NAMEALIAS[c] || c;
  return c.split(' ').filter((w) => w && !STOP.has(w));
}
function nameScore(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  // zusätzlich Substring-Bonus (z. B. "Bohemians" vs "Bohemian")
  let sub = 0;
  for (const x of A) for (const y of B) if (x.length > 3 && (x.includes(y) || y.includes(x))) sub++;
  return (inter + 0.5 * sub) / Math.max(A.size, B.size);
}
const TEAM_OK = 0.5;

// --- Cache-Helfer -----------------------------------------------------------
function cacheGet(file) {
  const p = join(CACHE, file);
  if (existsSync(p)) {
    try { const o = JSON.parse(readFileSync(p, 'utf8')); if (Date.now() - o._t < 6 * 3600e3 || o._final) return o.data; } catch {}
  }
  return null;
}
function cacheSet(file, data, final) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, file), JSON.stringify({ _t: Date.now(), _final: !!final, data }));
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- Provider: API-Football -------------------------------------------------
async function apiFootballDay(date) {
  if (!APIFOOTBALL_KEY) return null;
  const file = `apifootball_${date}.json`;
  const cached = cacheGet(file); if (cached) return cached;
  const j = await getJson(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=UTC`,
    { 'x-apisports-key': APIFOOTBALL_KEY });
  const games = (j.response || []).map((f) => ({
    id: f.fixture?.id,
    home: f.teams?.home?.name, away: f.teams?.away?.name,
    fh: f.goals?.home, fa: f.goals?.away,
    hh: f.score?.halftime?.home, ha: f.score?.halftime?.away,
    finished: ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short),
  }));
  // Tag nur dann dauerhaft einfrieren, wenn ALLE Spiele beendet sind.
  // Sonst (zukünftige/laufende Spiele) nur 6 h cachen, damit IDs/Quoten/Scores
  // nachgeladen werden, sobald die API sie hat.
  const final = games.length > 0 && games.every((g) => g.finished);
  cacheSet(file, games, final);
  return games;
}

// --- Provider: TheSportsDB (keyless Fallback) -------------------------------
async function sportsdbDay(date) {
  const file = `sportsdb_${date}.json`;
  const cached = cacheGet(file); if (cached) return cached;
  const j = await getJson(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsday.php?d=${date}&s=Soccer`);
  const games = (j.events || []).map((e) => ({
    home: e.strHomeTeam, away: e.strAwayTeam,
    fh: e.intHomeScore == null ? null : Number(e.intHomeScore),
    fa: e.intAwayScore == null ? null : Number(e.intAwayScore),
    hh: null, ha: null,
    finished: e.strStatus === 'Match Finished' || e.intHomeScore != null,
  }));
  const final = games.some((g) => g.finished);
  cacheSet(file, games, final);
  return games;
}

// In einem Tagesplan das passende Spiel suchen (auch mit vertauschten Teams)
function findGame(games, home, away) {
  let best = null, bestScore = 0;
  for (const g of games) {
    if (g.fh == null || g.fa == null) continue;
    const direct = Math.min(nameScore(home, g.home), nameScore(away, g.away));
    const swap = Math.min(nameScore(home, g.away), nameScore(away, g.home));
    const s = Math.max(direct, swap);
    if (s > bestScore) { bestScore = s; best = { g, swapped: swap > direct }; }
  }
  if (!best || bestScore < TEAM_OK) return null;
  const { g, swapped } = best;
  const ft = swapped ? [g.fa, g.fh] : [g.fh, g.fa];
  const ht = g.hh == null ? null : (swapped ? [g.ha, g.hh] : [g.hh, g.ha]);
  return { ft, ht };
}

// Datums-Fenster: viele "Bet of the Day"-Tipps liefern kein Datum -> match_date
// ist dann nur "heute", das Spiel kann aber morgen/übermorgen sein (z. B. WM).
const DATE_OFFSETS = [0, 1, 2, 3, -1];
const shiftDate = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// Bestes API-Football-Spiel im Datumsfenster um `date` (orientierungs-bewusst)
async function scanApi(home, away, date) {
  let best = null, bestScore = 0;
  for (const off of DATE_OFFSETS) {
    let games; try { games = await apiFootballDay(shiftDate(date, off)); } catch { continue; }
    if (!games) continue;
    for (const g of games) {
      const direct = Math.min(nameScore(home, g.home), nameScore(away, g.away));
      const swap = Math.min(nameScore(home, g.away), nameScore(away, g.home));
      const s = Math.max(direct, swap);
      if (s > bestScore) { bestScore = s; best = { g, swapped: swap > direct }; }
    }
    if (bestScore >= 0.95) break; // perfekter Treffer -> Fenster nicht weiter scannen
  }
  return best && bestScore >= TEAM_OK ? best : null;
}

async function apiResult(tip) {
  if (!tip.match_date) return null;
  // 1) API-Football im Datumsfenster
  const m = await scanApi(tip.home, tip.away, tip.match_date);
  if (m && m.g.fh != null && m.g.fa != null && m.g.finished) {
    const { g, swapped } = m;
    return { ft: swapped ? [g.fa, g.fh] : [g.fh, g.fa],
      ht: g.hh == null ? null : (swapped ? [g.ha, g.hh] : [g.hh, g.ha]), src: 'apifootball' };
  }
  // 2) TheSportsDB Fallback (nur match_date)
  try {
    const games = await sportsdbDay(tip.match_date);
    if (games) { const hit = findGame(games, tip.home, tip.away); if (hit) return { ...hit, src: 'sportsdb' }; }
  } catch {}
  return null;
}

// API-Football-Fixture (auch vor Anpfiff) im Datumsfenster finden – für Quoten.
// Liefert { id, swapped } (swapped = Teams in der API vertauscht).
export async function findApiFixture(home, away, date) {
  if (!APIFOOTBALL_KEY || !date) return null;
  const m = await scanApi(home, away, date);
  return m ? { id: m.g.id, swapped: m.swapped } : null;
}

// --- Öffentliche API --------------------------------------------------------
export async function resolveResult(tip, adapter) {
  if (adapter && typeof adapter.resolveResult === 'function') {
    try { const r = await adapter.resolveResult(tip); if (r && r.ft) return r; } catch {}
  }
  return apiResult(tip);
}
