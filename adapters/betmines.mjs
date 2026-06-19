// Adapter: BetMines Daily Bets (dailyDouble + dailyRisk).
// Ergebnisse über die persistenten Match-Seiten (predictions-..._<fixtureId>).
import { fetchHtml } from '../lib/fetch.mjs';

const URL = 'https://betmines.com/daily-bets-football';
const MATCH_BASE = 'https://betmines.com/matches/predictions-';
const slugify = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';

function parseNuxt(html) {
  const m = html.match(/window\.__NUXT__=(.*?);<\/script>/s);
  if (!m) throw new Error('window.__NUXT__ nicht gefunden');
  return new Function('window', `return (${m[1]});`)({});
}

function findFixtureById(nuxt, id) {
  let fallback = null; const seen = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 10 || seen.has(o)) return null;
    seen.add(o);
    if (o.localTeam && o.visitorTeam && ('ftScore' in o || 'timeStatus' in o)) {
      if (o.id === id) return o; fallback ??= o;
    }
    for (const k of Object.keys(o)) { const r = walk(o[k], d + 1); if (r) return r; }
    return null;
  };
  return walk(nuxt, 0) || fallback;
}

export default {
  id: 'betmines',
  name: 'BetMines – Daily Bets',
  url: URL,

  parse(html) {
    const bb = parseNuxt(html)?.state?.best_bets;
    if (!bb) return [];
    const tips = [];
    for (const [type, key] of [['double', 'dailyDouble'], ['acca', 'dailyRisk']]) {
      const g = bb[key]; if (!g || !Array.isArray(g.fixtures)) continue;
      for (const f of g.fixtures) {
        const fx = f.fixture || {};
        const home = fx.localTeam?.name, away = fx.visitorTeam?.name;
        if (!home || !away) continue;
        tips.push({
          home, away, league: fx.league?.name ?? null,
          kickoff: fx.dateTime ?? null,
          market: f.betResult,                 // Codes O15/O25/GG/... = eigene Codes
          market_raw: f.betResult,
          odds: f.betResultQuote == null ? null : Number(f.betResultQuote),
          slip_type: type, slip_ref: `bm-${g.id}`,
          slip_odds: g.quote == null ? null : Number(g.quote),
          ext_id: String(fx.id ?? ''),
          source_url: `${MATCH_BASE}${slugify(home)}-${slugify(away)}_${fx.id}`,
        });
      }
    }
    return tips;
  },

  // Endstand von der Match-Seite (persistent, mit ftScore/htScore)
  async resolveResult(tip) {
    if (!tip.ext_id) return null;
    const html = await fetchHtml(tip.source_url ||
      `${MATCH_BASE}match_${tip.ext_id}`);
    const fx = findFixtureById(parseNuxt(html), Number(tip.ext_id));
    if (!fx) return null;
    const finished = fx.matchEndend === true ||
      ['FT', 'AET', 'FT_PEN', 'AWARDED'].includes(fx.timeStatus);
    const parse = (s) => { const m = typeof s === 'string' && s.match(/^(\d+)\s*-\s*(\d+)$/); return m ? [+m[1], +m[2]] : null; };
    const ft = parse(fx.ftScore) || (fx.localTeamScore != null && fx.visitorTeamScore != null
      ? [Number(fx.localTeamScore), Number(fx.visitorTeamScore)] : null);
    if (!finished || !ft) return null;
    return { ft, ht: parse(fx.htScore), src: 'matchpage' };
  },
};
