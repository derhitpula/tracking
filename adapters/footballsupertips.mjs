// Adapter: footballsuper.tips – Tip of the Day
// Format im .fulltipdivs: "{Markt} in {Home} v {Away} {Liga}", Quote als "Total Odd: x"
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll } from '../lib/parse.mjs';

const LEAGUE = /\b(World Cup|Premier League|Champions? League|Europa|Serie [A-Z]|La ?Liga|Bundesliga|Ligue \d|Championship|Division|Eredivisie|Cup|League|Liga|\d{4})\b/;

export default {
  id: 'footballsupertips',
  name: 'Football Super Tips – Tip of the Day',
  url: 'https://www.footballsuper.tips/football-accumulators-tips/football-tips-prediction-of-the-day/',
  parse(html) {
    const totalOdd = parseOdds((html.match(/Total Odd:\s*([\d.]+)/i) || [])[1] || '');
    const tips = [];
    for (const m of matchAll(html, /class="fulltipdivs"[^>]*>(.*?)<\/div>/gs)) {
      const txt = stripTags(m[1]);
      const mm = txt.match(/^(.*?)\s+in\s+(.*)$/i);
      if (!mm) continue;
      const market_raw = mm[1].trim();
      // Liga vom Auswärtsnamen abtrennen
      let rest = mm[2].trim();
      const lg = rest.search(LEAGUE);
      const league = lg > 0 ? rest.slice(lg).trim() : null;
      if (lg > 0) rest = rest.slice(0, lg).trim();
      const teams = splitTeams(rest);
      if (!teams) continue;
      tips.push({ ...teams, league, market_raw, odds: totalOdd, slip_odds: totalOdd });
    }
    return tips;
  },
};
