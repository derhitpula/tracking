// Adapter: footballtips.com – Bet of the Day (bis zu 3 Tage im Voraus)
// Markup: <strong class="tips-card__title">Teams</strong>
//         <span class="badge">Pick</span> ... <span class="tips-card__league">4/11</span>
// Datum: Karten-Heading "<Wochentag> Bet of the Day" + "Today/Tomorrow | 8:00 pm".
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll, dateForWeekday, timeToIso } from '../lib/parse.mjs';

const DAY = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+Bet of the Day/gi;

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
      // Wochentag aus dem nächstgelegenen vorausgehenden Heading -> echtes Datum
      const before = html.slice(Math.max(0, m.index - 900), m.index);
      const day = [...before.matchAll(DAY)].pop()?.[1];
      const match_date = day ? dateForWeekday(day) : undefined;
      // Zeit nur aus dem "Today/Tomorrow | 8:00 pm"-Muster (sonst keine)
      const time = (before.match(/(?:Today|Tomorrow)\s*\|\s*(\d{1,2}:\d{2}\s*[ap]m)/i) || [])[1];
      const kickoff = match_date ? timeToIso(match_date, time) : undefined;
      tips.push({ ...teams, market_raw, odds, match_date, kickoff });
    }
    return tips;
  },
};
