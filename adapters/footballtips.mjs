// Adapter: footballtips.com – Bet of the Day
// Markup: <strong class="tips-card__title">Teams</strong>
//         <span class="badge">Pick</span> ... <span class="tips-card__league">4/11</span>
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll } from '../lib/parse.mjs';

export default {
  id: 'footballtips',
  name: 'FootballTips.com – Bet of the Day',
  url: 'https://www.footballtips.com/tips/bet-of-the-day/',
  parse(html) {
    const tips = [];
    const re = /tips-card__title">(.*?)<\/strong>.*?class="badge">(.*?)<\/span>.*?tips-card__league">(.*?)<\/span>/gs;
    for (const m of matchAll(html, re)) {
      const teams = splitTeams(stripTags(m[1])); if (!teams) continue;
      const market_raw = stripTags(m[2]);
      const odds = parseOdds(stripTags(m[3]));
      tips.push({ ...teams, market_raw, odds });
    }
    return tips;
  },
};
