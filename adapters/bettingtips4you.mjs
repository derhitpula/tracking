// Adapter: bettingtips4you.com – Bet of the Day
// Markup: <div class="bt4y-bod-leg">USA v Australia – Both Teams To Score - Yes</div>
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll } from '../lib/parse.mjs';

export default {
  id: 'bettingtips4you',
  name: 'BettingTips4You – Bet of the Day',
  url: 'https://bettingtips4you.com/best-bets/bet-of-the-day/',
  parse(html) {
    const legs = matchAll(html, /class="bt4y-bod-leg">(.*?)<\/div>/gs).map((m) => stripTags(m[1]));
    // Gesamtquote (falls vorhanden) für die Kombi
    const oddsAll = parseOdds((html.match(/bt4y-bod-odds[^>]*>(.*?)<\/[a-z]+>/s) || [])[1] || '');
    const tips = [];
    for (const leg of legs) {
      const parts = leg.split(/\s+[–—-]\s+/); // "Teams – Markt"
      if (parts.length < 2) continue;
      const teams = splitTeams(parts[0]); if (!teams) continue;
      const market_raw = parts.slice(1).join(' - ').trim();
      tips.push({ ...teams, market_raw, odds: null,
        slip_type: legs.length > 1 ? 'acca' : 'single', slip_odds: oddsAll });
    }
    return tips;
  },
};
