// Adapter: freetips.com – Bet of the Day
// Markup: .m-name = "Scotland v Morocco", .plr-name = "Away Win (8/11)"
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll, parseDayMonth } from '../lib/parse.mjs';

export default {
  id: 'freetips',
  name: 'FreeTips – Bet of the Day',
  url: 'https://www.freetips.com/betting/bet-of-the-day/',
  parse(html) {
    const names = matchAll(html, /class="m-name">(.*?)<\/span>/gs).map((m) => stripTags(m[1]));
    const picks = matchAll(html, /class="plr-name">(.*?)<\/span>/gs).map((m) => stripTags(m[1]));
    const dates = matchAll(html, /class="[^"]*betacctime[^"]*"[^>]*>(.*?)<\/[a-z]+>/gs).map((m) => stripTags(m[1]));
    const tips = [];
    for (let i = 0; i < names.length && i < picks.length; i++) {
      const teams = splitTeams(names[i]); if (!teams) continue;
      const pick = picks[i];
      const odds = parseOdds(pick);
      let market_raw = pick.replace(/\s*\(.*?\)\s*/g, '').replace(/\d+\.\d+/, '').trim();
      // "Yes" / "No" allein = BTTS (freetips zeigt Markt-Label separat)
      if (/^yes$/i.test(market_raw)) market_raw = 'BTTS - Yes';
      if (/^no$/i.test(market_raw)) market_raw = 'BTTS - No';
      const dt = parseDayMonth(dates[i]); // echtes Spieldatum, falls vorhanden
      tips.push({ ...teams, market_raw, odds, match_date: dt?.date, kickoff: dt?.kickoff,
        slip_type: names.length > 1 ? 'acca' : 'single' });
    }
    return tips;
  },
};
