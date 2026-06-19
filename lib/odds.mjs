// Referenzquoten: API-Football (Bet365) als Primärquelle,
// The Odds API (1xBet bevorzugt) als Fallback für nicht abgedeckte Ligen.
// Beide Quellen cachen pro Spiel / Sport / Tag.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UA } from './fetch.mjs';
import { betmonitorOdds } from './betmonitor.mjs';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'results_cache');
const KEY = process.env.APIFOOTBALL_KEY || '';
const BOOKMAKER = process.env.ODDS_BOOKMAKER || '8'; // 8 = Bet365
const TODDS_KEY = process.env.THEODDSAPI_KEY || '';

// ─── API-Football ─────────────────────────────────────────────────────────────

async function fixtureBets(fixtureId) {
  const file = join(CACHE, `odds_${fixtureId}.json`);
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch {} }
  if (!KEY) return null;
  const res = await fetch(`https://v3.football.api-sports.io/odds?fixture=${fixtureId}`,
    { headers: { 'User-Agent': UA, 'x-apisports-key': KEY } });
  if (!res.ok) return null;
  const j = await res.json();
  const bookmakers = j.response?.[0]?.bookmakers || [];
  const preferred = bookmakers.find((b) => String(b.id) === BOOKMAKER);
  const bets = (preferred || bookmakers[0])?.bets || [];
  if (bets.length) { mkdirSync(CACHE, { recursive: true }); writeFileSync(file, JSON.stringify(bets)); }
  return bets.length ? bets : null;
}

function mapping(code) {
  let m;
  if (code === '1') return [/^match winner$/i, /^home$/i];
  if (code === 'X') return [/^match winner$/i, /^draw$/i];
  if (code === '2') return [/^match winner$/i, /^away$/i];
  if (code === '1X') return [/double chance/i, /home\/draw/i];
  if (code === '12') return [/double chance/i, /home\/away/i];
  if (code === 'X2') return [/double chance/i, /draw\/away/i];
  if (code === 'GG') return [/both teams.*score/i, /^yes$/i];
  if (code === 'NG') return [/both teams.*score/i, /^no$/i];
  if ((m = code.match(/^O([0-5])5$/))) return [/goals over\/under/i, new RegExp(`^over ${m[1]}\\.5$`, 'i')];
  if ((m = code.match(/^U([0-5])5$/))) return [/goals over\/under/i, new RegExp(`^under ${m[1]}\\.5$`, 'i')];
  return null;
}

const FLIP = { 1: '2', 2: '1', '1X': 'X2', X2: '1X' };
const flip = (code, swapped) => (swapped && FLIP[code]) ? FLIP[code] : code;

// ─── The Odds API ─────────────────────────────────────────────────────────────

// Alle Soccer-Ligen die The Odds API kennt
const TODDS_SPORTS = [
  'soccer_brazil_serie_b', 'soccer_china_superleague', 'soccer_conmebol_copa_libertadores',
  'soccer_conmebol_copa_sudamericana', 'soccer_epl', 'soccer_fifa_world_cup',
  'soccer_finland_veikkausliiga', 'soccer_germany_dfb_pokal', 'soccer_italy_serie_a',
  'soccer_league_of_ireland', 'soccer_norway_eliteserien', 'soccer_spain_segunda_division',
  'soccer_sweden_allsvenskan', 'soccer_sweden_superettan',
];

// Alle Events eines Sports für ein Datum cachen (ein Call pro Sport pro Tag)
async function fetchToddsEvents(sport, date) {
  const file = join(CACHE, `todds_${sport}_${date}.json`);
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch {} }
  if (!TODDS_KEY) return [];
  const from = `${date}T00:00:00Z`, to = `${date}T23:59:59Z`;
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/` +
    `?apiKey=${TODDS_KEY}&regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso` +
    `&commenceTimeFrom=${from}&commenceTimeTo=${to}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return [];
    const events = await res.json();
    if (!Array.isArray(events)) return [];
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(events));
    return events;
  } catch { return []; }
}

// Einfacher Token-Vergleich für The Odds API Team-Namen
const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function simScore(a, b) {
  const A = clean(a).split(' ').filter(Boolean);
  const B = new Set(clean(b).split(' ').filter(Boolean));
  if (!A.length || !B.size) return 0;
  const inter = A.filter((w) => B.has(w)).length;
  return inter / Math.max(A.length, B.size);
}

// Quoten aus gecachten Events suchen (h2h-Markt → 1xBet bevorzugt)
function pickToddsOdds(events, home, away, code) {
  let best = null, bestScore = 0;
  for (const ev of events) {
    const d = Math.min(simScore(home, ev.home_team), simScore(away, ev.away_team));
    const s2 = Math.min(simScore(home, ev.away_team), simScore(away, ev.home_team));
    const s = Math.max(d, s2);
    if (s > bestScore) { bestScore = s; best = { ev, swapped: s2 > d }; }
  }
  if (!best || bestScore < 0.45) return null;
  const { ev, swapped } = best;
  const effectiveCode = flip(code, swapped);
  const bm = ev.bookmakers?.find((b) => /1xbet/i.test(b.title)) || ev.bookmakers?.[0];
  if (!bm) return null;
  const h2h = bm.markets?.find((m) => m.key === 'h2h');
  if (!h2h) return null;
  // Outcome-Mapping: 1=home_team, 2=away_team, X=Draw
  const targetName = effectiveCode === 'X' ? 'Draw'
    : effectiveCode === '1' ? ev.home_team : ev.away_team;
  const outcome = h2h.outcomes.find((o) =>
    effectiveCode === 'X' ? o.name === 'Draw' : simScore(o.name, targetName) > 0.45,
  );
  return outcome ? Number(outcome.price) : null;
}

// Datum um N Tage verschieben
const shiftDate = (d, n) => {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const DATE_OFFSETS = [0, 1, 2, 3, -1];

// Alle Sports für ein Datum laden (parallel, gecacht)
async function loadToddsDay(date) {
  const all = await Promise.all(TODDS_SPORTS.map((s) => fetchToddsEvents(s, date)));
  return all.flat();
}

// Suche im ±3-Tage-Fenster (wie scanApi in results.mjs)
async function theoddsapiOdds(home, away, date, code) {
  if (!TODDS_KEY || !date || !['1', 'X', '2'].includes(code)) return null;
  for (const off of DATE_OFFSETS) {
    const events = await loadToddsDay(shiftDate(date, off));
    const odds = pickToddsOdds(events, home, away, code);
    if (odds != null) return odds;
  }
  return null;
}

// ─── Öffentliche API ──────────────────────────────────────────────────────────

export async function referenceOdds(fixtureId, code, swapped = false) {
  // 1) API-Football (Bet365 bevorzugt, sonst erster verfügbarer Buchmacher)
  const map = mapping(flip(code, swapped));
  if (fixtureId && map) {
    const bets = await fixtureBets(fixtureId);
    if (bets) {
      const bet = bets.find((b) => map[0].test(b.name));
      if (bet) {
        const val = bet.values.find((v) => map[1].test(String(v.value)));
        if (val) return Number(val.odd);
      }
    }
  }
  return null;
}

// Fallback-Suche: The Odds API (1xBet) → Betmonitor (alle Ligen, täglich gecacht).
export async function referenceOddsFallback(home, away, date, code) {
  const byOddsApi = await theoddsapiOdds(home, away, date, code);
  if (byOddsApi != null) return byOddsApi;
  return betmonitorOdds(home, away, date, code);
}
