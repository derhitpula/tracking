// Adapter: soccervital.com – Bet of the Day Bankers
// Markup: <tr class="twom">...<timegame>HH:MM</a>...<hometeam>X</div>...<awayteam>Y</div>
//         ...<center260>N on Team (1.XX)</td>...</tr>
// N = Konfidenz (1-10), "on Team" = Tipp-Richtung, (odds) = Dezimalquote.
// Zeiten sind UK-Zeit (Europe/London) -> nach UTC umrechnen. Spiele vor 06:00
// finden nach Mitternacht statt und gehören zum nächsten Kalendertag.
import { matchAll, parseOdds } from '../lib/parse.mjs';
import { wallToUtcIso, todayInTz, addDays } from '../lib/time.mjs';

const TZ = 'Europe/London';

export default {
  id: 'soccervital',
  name: 'SoccerVital – Bet of the Day Bankers',
  url: 'https://www.soccervital.com/bet/',
  parse(html) {
    const tips = [];
    const base = todayInTz(TZ); // "today" der Seite = heutiger Tag in UK

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

      // UK-Wandzeit -> UTC. Spiele vor 06:00 laufen nach Mitternacht -> Folgetag.
      let kickoff = null, match_date = base;
      if (time) {
        const hh = parseInt(time, 10);
        const dateStr = hh < 6 ? addDays(base, 1) : base;
        kickoff = wallToUtcIso(dateStr, time, TZ);
        match_date = kickoff.slice(0, 10); // UTC-Tag des Anstoßes
      }
      tips.push({ home, away, market_raw, odds, match_date, kickoff });
    }
    return tips;
  },
};
