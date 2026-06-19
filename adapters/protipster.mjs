// Adapter: protipster.com – Bet of the Day
// Die Seite bettet ein JSON mit hostName/opponentName ein; der Tipp steht im
// Prosatext ("We expect <Team> to take the win").
import { stripTags } from '../lib/fetch.mjs';
import { parseOdds } from '../lib/parse.mjs';

export default {
  id: 'protipster',
  name: 'ProTipster – Bet of the Day',
  url: 'https://www.protipster.com/betting-tips/bet-of-the-day',
  parse(html) {
    const host = (html.match(/"hostName":"(.*?)"/) || [])[1];
    const opp = (html.match(/"opponentName":"(.*?)"/) || [])[1];
    if (!host || !opp) return [];
    const home = host.replace(/\\u[0-9a-f]{4}/gi, '').trim();
    const away = opp.replace(/\\u[0-9a-f]{4}/gi, '').trim();
    // Pick aus dem Experten-Block
    const pickBlock = stripTags((html.match(/class="expert-pick[^"]*"[^>]*>(.*?)<\/div>/s) || [])[1] || '');
    const h3 = stripTags((html.match(/<h3>(.*?)<\/h3>/s) || [])[1] || '');
    let market_raw = h3 || pickBlock.slice(0, 40);
    // "expect <Team> to take the win" -> Heim/Auswärtssieg
    const fav = (pickBlock.match(/expect\s+([A-Z][\w. ]+?)\s+to\s+(?:take|win|claim)/i) || [])[1];
    if (/win/i.test(market_raw) && fav) {
      market_raw = fav.trim().toLowerCase().includes(home.toLowerCase().split(' ')[0]) ? 'Home Win' : 'Away Win';
    }
    const odds = parseOdds(pickBlock);
    return [{ home, away, market_raw, odds }];
  },
};
