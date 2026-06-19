// Referenzquoten: echte Buchmacherquote pro Spiel+Markt aus API-Football.
// So wird derselbe Tipp quellenübergreifend mit DERSELBEN Quote bewertet
// (fairer Vergleich) und fehlende Quoten werden gefüllt.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UA } from './fetch.mjs';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'results_cache');
const KEY = process.env.APIFOOTBALL_KEY || '';
const BOOKMAKER = process.env.ODDS_BOOKMAKER || '8'; // 8 = Bet365

async function fixtureBets(fixtureId) {
  const file = join(CACHE, `odds_${fixtureId}.json`);
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch {} }
  if (!KEY) return null;
  // Alle Buchmacher auf einmal holen (1 API-Call) -> Bet365 bevorzugen, sonst erster
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

// Markt-Code -> API-Football Bet-Name + erwarteter Wert
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

// Sind die Teams in der API vertauscht, dreht sich der Tipp aus Heim-Sicht
const FLIP = { 1: '2', 2: '1', '1X': 'X2', X2: '1X' };
const flip = (code, swapped) => (swapped && FLIP[code]) ? FLIP[code] : code;

// Referenzquote für Fixture + Markt-Code (oder null). swapped = API-Orientierung.
export async function referenceOdds(fixtureId, code, swapped = false) {
  const map = mapping(flip(code, swapped));
  if (!fixtureId || !map) return null;
  const bets = await fixtureBets(fixtureId);
  if (!bets) return null;
  const bet = bets.find((b) => map[0].test(b.name));
  if (!bet) return null;
  const val = bet.values.find((v) => map[1].test(String(v.value)));
  return val ? Number(val.odd) : null;
}
