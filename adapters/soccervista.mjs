// Adapter: soccervista.com – Predictions
// HINWEIS: Die /predictions/-Seite ist überwiegend eine Index-/Linkseite; die
// eigentlichen Prognosen werden client-seitig bzw. auf Unterseiten geladen.
// Best-effort: lese Match-Zeilen aus sichtbaren Tabellen; liefert sonst [].
// TODO: passende Unterseite / Datenquelle anbinden.
import { stripTags } from '../lib/fetch.mjs';
import { splitTeams, parseOdds, matchAll } from '../lib/parse.mjs';

export default {
  id: 'soccervista',
  name: 'SoccerVista – Predictions',
  url: 'https://www.soccervista.com/predictions/',
  parse(html) {
    const tips = [];
    for (const m of matchAll(html, /<tr[^>]*>(.*?)<\/tr>/gs)) {
      const cells = matchAll(m[1], /<td[^>]*>(.*?)<\/td>/gs).map((c) => stripTags(c[1]));
      const teamCell = cells.find((c) => / - | vs? /i.test(c));
      const teams = teamCell ? splitTeams(teamCell) : null;
      if (!teams) continue;
      const pick = cells.find((c) => /\d\.\d|over|under|btts|[12x]/i.test(c)) || '';
      tips.push({ ...teams, market_raw: pick, odds: parseOdds(pick) });
    }
    return tips;
  },
};
