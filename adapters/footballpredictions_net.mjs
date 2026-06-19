// Adapter: footballpredictions.net (DE) – Wette des Tages / Prognosen
// Markup: .team-label paarweise (Heim/Auswärts), .prediction-holder = Pick (deutsch).
// Hinweis: deutsche Teamnamen -> API-Ergebnis-Matching gelingt v. a. bei Nationen.
import { stripTags } from '../lib/fetch.mjs';
import { matchAll } from '../lib/parse.mjs';

export default {
  id: 'footballpredictions_net',
  name: 'FootballPredictions.net (DE) – Wette des Tages',
  url: 'https://footballpredictions.net/de/bet-of-the-day',
  parse(html) {
    const labels = matchAll(html, /class="team-label"[^>]*>(.*?)<\/[a-z]+>/gs).map((m) => stripTags(m[1])).filter(Boolean);
    const picks = matchAll(html, /class="prediction-holder"[^>]*>(.*?)<\/div>/gs)
      .map((m) => stripTags(m[1]).replace(/^[^A-Za-zÄÖÜ]+/, '').trim());
    const tips = [];
    for (let i = 0; i < picks.length; i++) {
      const home = labels[2 * i], away = labels[2 * i + 1];
      if (!home || !away || !picks[i]) continue;
      tips.push({ home, away, market_raw: picks[i], odds: null });
    }
    return tips;
  },
};
