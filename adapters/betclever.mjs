// Adapter: betclever.com – Bet of the Day (algorithm-based, CSR via Browser)
// Tipps sind Client-seitig gerendert. Jede betslipadd-Schaltfläche enthält
// data-match, data-selection und data-decodds als stabile Attribute.
// Es werden nur Tipps des heutigen Tages übernommen (Tagesname im Zeitfeld).
import { matchAll } from '../lib/parse.mjs';
import { fetchViaBrowser } from '../lib/browser.mjs';

export default {
  id: 'betclever',
  name: 'BetClever – Bet of the Day',
  url: 'https://betclever.com/football-tips/bet-of-the-day/',
  async fetch() { return fetchViaBrowser(this.url) || ''; },
  parse(html) {
    const tips = [];
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }); // "Friday"
    const todayDate = new Date().toISOString().slice(0, 10);

    for (const m of matchAll(html, /class="betslipadd"([^>]+)>/g)) {
      const attrs = m[1];
      const matchStr = (attrs.match(/data-match="([^"]+)"/) || [])[1];
      const sel      = (attrs.match(/data-selection="([^"]+)"/) || [])[1];
      const odds     = parseFloat((attrs.match(/data-decodds="([^"]+)"/) || [])[1] || '') || null;
      if (!matchStr || !sel) continue;

      // Nächste zeitangabe vor dem Button suchen
      const before  = html.slice(Math.max(0, m.index - 1500), m.index);
      const timeEl  = [...before.matchAll(/class="singles__item-right-time"[^>]*>(.*?)<\/div>/g)].pop();
      const timeStr = timeEl?.[1]?.trim() || '';

      // Nur heutige Spiele
      if (!timeStr.toLowerCase().startsWith(todayName.toLowerCase())) continue;

      // "USA vs Australia" -> home/away
      const vs = matchStr.match(/^(.*?) vs (.+)$/i);
      if (!vs) continue;
      const home = vs[1].trim();
      const away = vs[2].trim();

      // "Friday 20:00 PM" -> ISO kickoff (PM bereits in 24h-Format angegeben)
      const tm = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      let kickoff = null;
      if (tm) {
        let h = parseInt(tm[1]);
        if (/pm/i.test(tm[3]) && h !== 12) h += 12;
        else if (/am/i.test(tm[3]) && h === 12) h = 0;
        kickoff = `${todayDate}T${String(h).padStart(2, '0')}:${tm[2]}:00Z`;
      }

      tips.push({ home, away, market_raw: sel, odds, match_date: todayDate, kickoff });
    }
    return tips;
  },
};
