// Adapter: soccervista.com – Predictions (Bet of the Day)
// Nutzt die interne JSON-API statt HTML-Parsing (kein Cloudflare, kein Browser nötig).
// Endpoint: /events/by/date/{d-m-Y}/ → Array von Ligen mit Spielen + Prognosen.
// Kriterium: predictionPoints === 10 (maximale Konfidenz) + nicht abgesagt/verlegt.
// Market: prediction1x2 → '1' / 'X' / '2' (direkte Market-Codes).
import { UA } from '../lib/fetch.mjs';

export default {
  id: 'soccervista',
  name: 'SoccerVista – Bet of the Day',
  url: 'https://www.soccervista.com/predictions/',

  async fetch() {
    const now = new Date();
    const d = String(now.getUTCDate()).padStart(2, '0');
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const y = now.getUTCFullYear();
    const res = await globalThis.fetch(
      `https://www.soccervista.com/events/by/date/${d}-${m}-${y}/`,
      { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.soccervista.com/predictions/' } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },

  parse(text) {
    let data;
    try { data = JSON.parse(text); } catch { return []; }
    if (!Array.isArray(data)) return [];
    const tips = [];
    for (const league of data) {
      for (const ev of (league.events || [])) {
        if (ev.isCancelled || ev.isPostponed || ev.isFinished) continue;
        if (ev.prediction1x2 == null || ev.predictionPoints !== 10) continue;
        const market = String(ev.prediction1x2); // '1', 'X', '2'
        const winner = market === '1' ? ev.homeTeam : market === '2' ? ev.awayTeam : null;
        const market_raw = winner ? `Sieg ${winner}` : 'Unentschieden';
        const ko = ev.timeStart ? new Date(ev.timeStart * 1000).toISOString() : null;
        tips.push({
          home: ev.homeTeam,
          away: ev.awayTeam,
          market,
          market_raw,
          match_date: ko ? ko.slice(0, 10) : new Date().toISOString().slice(0, 10),
          kickoff: ko,
        });
      }
    }
    return tips;
  },
};
