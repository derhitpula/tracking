// Adapter: thatsagoal – Bet of the Day
// Markup: <div class="tip p-2 ...">⚽ Home vs Away <a class="prediction ...">Pick odds</a>
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll } from '../lib/parse.mjs';

export default {
  id: 'thatsagoal',
  name: "That's a Goal – Bet of the Day",
  url: 'https://www.thatsagoal.com/football-tips/bet-of-the-day',
  parse(html) {
    const tips = [];
    for (const m of matchAll(html, /class="tip p-2[^"]*">(.*?)<\/div>/gs)) {
      const inner = m[1];
      const teams = splitTeams(stripTags(inner.split('<a')[0]));
      if (!teams) continue;
      const predTxt = stripTags((inner.match(/class="prediction[^"]*"[^>]*>(.*?)<\/a>/s) || [])[1] || '');
      const odds = parseOdds(predTxt) ?? parseOdds(stripTags(inner));
      const market_raw = predTxt.replace(/\d{1,3}\s*\/\s*\d{1,3}|\d+\.\d+/g, '').trim() || predTxt;
      tips.push({ ...teams, market_raw, odds });
    }
    return tips;
  },
};
