// Adapter: footyaccumulators.com – Bet of the Day
// HINWEIS: Die Pick-Auswahl wird client-seitig gerendert und liegt nicht im
// SSR-HTML (__NEXT_DATA__ editor_state ist leer). Best-effort: versuche den Tipp
// aus sichtbarem Markup zu lesen; liefert sonst [] (bricht die Pipeline nicht).
// TODO: ggf. interne JSON-/API-Quelle der Seite anbinden.
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll } from '../lib/parse.mjs';

export default {
  id: 'footyaccumulators',
  name: 'Footy Accumulators – Bet of the Day',
  url: 'https://footyaccumulators.com/football-tips/bet-of-the-day',
  parse(html) {
    const tips = [];
    // Versuch: Blöcke mit Teamnamen + Markt im gerenderten HTML
    for (const m of matchAll(html, /class="[^"]*(?:selection|tip-bet|fixture)[^"]*"[^>]*>(.*?)<\/(?:div|li)>/gs)) {
      const txt = stripTags(m[1]);
      const teams = splitTeams(txt);
      // nur echte Markt-Angaben, nicht bloß den Spielnamen übernehmen
      if (teams && /(over|under|btts|both teams|win|draw|double chance|\d\.\d)/i.test(txt.replace(/.* vs? /i, ''))) {
        tips.push({ ...teams, market_raw: txt.replace(/^.*? vs? .*? /i, '').trim() || txt, odds: parseOdds(txt) });
      }
    }
    return tips;
  },
};
