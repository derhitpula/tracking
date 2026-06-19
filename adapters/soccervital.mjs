// Adapter: soccervital.com – Bet of the Day Bankers
// Markup: <tr class="twom">...<timegame>HH:MM</a>...<hometeam>X</div>...<awayteam>Y</div>
//         ...<center260>N on Team (1.XX)</td>...</tr>
// N = Konfidenz (1-10), "on Team" = Tipp-Richtung, (odds) = Dezimalquote.
import { matchAll, parseOdds } from '../lib/parse.mjs';

export default {
  id: 'soccervital',
  name: 'SoccerVital – Bet of the Day Bankers',
  url: 'https://www.soccervital.com/bet/?sh=-2',
  parse(html) {
    const tips = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const m of matchAll(html, /<tr class="twom"[^>]*>(.*?)<\/tr>/gs)) {
      const row = m[1];
      const time  = (row.match(/class="timegame"[^>]*>(\d{1,2}:\d{2})<\/a>/) || [])[1];
      const home  = (row.match(/class="hometeam">(.*?)<\/div>/) || [])[1]?.trim();
      const away  = (row.match(/class="awayteam">(.*?)<\/div>/) || [])[1]?.trim();
      const cell  = (row.match(/class="center260">(.*?)<\/td>/) || [])[1]?.trim();
      if (!home || !away || !cell) continue;

      // "10 on Argentina (1.4)"  oder  "8 Draw (1.53)"
      const pm = cell.match(/^(\d+)\s+on\s+(.*?)(?:\s*\(([0-9.]+)\))?$/) ||
                 cell.match(/^(\d+)\s+(Draw)(?:\s*\(([0-9.]+)\))?$/i);
      if (!pm) continue;
      const picked = pm[2].trim();
      const odds   = pm[3] ? +pm[3] : parseOdds(cell);

      let market_raw;
      if (/draw/i.test(picked)) {
        market_raw = 'Draw';
      } else if (picked === home || home.toLowerCase().startsWith(picked.toLowerCase().split(' ')[0].toLowerCase())) {
        market_raw = 'Home Win';
      } else if (picked === away || away.toLowerCase().startsWith(picked.toLowerCase().split(' ')[0].toLowerCase())) {
        market_raw = 'Away Win';
      } else {
        market_raw = picked; // Fallback: Rohtext
      }

      const kickoff = time ? `${today}T${time.padStart(5, '0')}:00Z` : null;
      tips.push({ home, away, market_raw, odds, match_date: today, kickoff });
    }
    return tips;
  },
};
