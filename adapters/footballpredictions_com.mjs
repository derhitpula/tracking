// Adapter: footballpredictions.com – Bet of the Day
// Markup: .botd-match-home/.botd-match-away enthalten den Teamnamen,
//         .botd-bet <a> den Pick ("USA to win at 1.60").
import { stripTags } from '../lib/fetch.mjs';
import { parseOdds } from '../lib/parse.mjs';

// letzter <div>Klartext</div> (= Teamname) innerhalb eines Blocks
const lastName = (block) => {
  const all = [...block.matchAll(/<div>\s*([^<>]{1,40}?)\s*<\/div>/g)].map((m) => m[1].trim()).filter(Boolean);
  return all.at(-1) || null;
};
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = b ? s.indexOf(b, i) : -1; return s.slice(i, j < 0 ? i + 500 : j); };

export default {
  id: 'footballpredictions_com',
  name: 'FootballPredictions.com – Bet of the Day',
  url: 'https://footballpredictions.com/betting-tips/bet-of-the-day/',
  parse(html) {
    const home = lastName(between(html, 'botd-match-home', 'botd-match-away'));
    const away = lastName(between(html, 'botd-match-away', 'botd-bet'));
    const pick = stripTags((html.match(/class="botd-bet"><a[^>]*>(.*?)<\/a>/s) || [])[1] || '');
    if (!home || !away || !pick) return [];
    const odds = parseOdds(pick.replace(/.*\bat\b/, ''));
    const market_raw = pick.replace(/\s*\bat\b\s*[\d.]+.*$/, '').trim();
    return [{ home, away, market_raw, odds }];
  },
};
