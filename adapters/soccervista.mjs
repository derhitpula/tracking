// Adapter: soccervista.com – Predictions (Bet of the Day)
// Nutzt die interne JSON-API statt HTML-Parsing (kein Cloudflare, kein Browser nötig).
// Endpoint: /events/by/date/{d-m-Y}/ → Array von Ligen mit Spielen + Prognosen.
// Kriterium: predictionPoints === 10 (maximale Konfidenz) + nicht abgesagt/verlegt.
// Market: prediction1x2 → '1' / 'X' / '2' (direkte Market-Codes).
//
// Blocklist: Ligen die SoccerVista im JS clientseitig ausfiltert (nicht auf der Predictions-Seite).
// tournamentTemplateId aus dem /events/by/date/ Endpoint.
import { UA } from '../lib/fetch.mjs';

const LEAGUE_BLOCKLIST = new Set([
  '21McUfjf', // USL League Two (US-Amateur)
  'ATL2voyk', // Niger Super Ligue
]);

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
    // Dedup per Kickoff-Timestamp: SoccerVista listet dasselbe Spiel oft in mehreren
    // Liga-Blöcken (manchmal mit leicht verschiedenen Teamnamen). Ersten Treffer behalten.
    const seenKickoff = new Set();
    for (const league of data) {
      if (LEAGUE_BLOCKLIST.has(league.tournamentTemplateId)) continue;
      for (const ev of (league.events || [])) {
        if (ev.isCancelled || ev.isPostponed) continue;
        if (ev.prediction1x2 == null || ev.predictionPoints !== 10) continue;
        if (ev.timeStart && seenKickoff.has(ev.timeStart)) continue;
        if (ev.timeStart) seenKickoff.add(ev.timeStart);
        const market = String(ev.prediction1x2); // '1', 'X', '2'
        // market_raw = konstanter Markttyp-String → Konfliktschlüssel ist pro Spiel eindeutig.
        // Ändert SoccerVista seine Prognose, wird dieselbe Zeile per UPSERT überschrieben
        // statt eine zweite Zeile zu erzeugen (Duplikat-Problem).
        const market_raw = '1X2';
        const ko = ev.timeStart ? new Date(ev.timeStart * 1000).toISOString() : null;
        tips.push({
          home: (ev.homeTeam || '').trim(),
          away: (ev.awayTeam || '').trim(),
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
