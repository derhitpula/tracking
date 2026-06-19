// Adapter: protipster.com – Bet of the Day
// JSON im HTML enthält: hostName, opponentName, predictionPhrase, currentRawOdd
export default {
  id: 'protipster',
  name: 'ProTipster – Bet of the Day',
  url: 'https://www.protipster.com/betting-tips/bet-of-the-day',
  parse(html) {
    const host   = (html.match(/"hostName":"(.*?)"/) || [])[1];
    const opp    = (html.match(/"opponentName":"(.*?)"/) || [])[1];
    const phrase = (html.match(/"predictionPhrase":"(.*?)"/) || [])[1];
    if (!host || !opp || !phrase) return [];
    const home       = host.replace(/\\u[0-9a-f]{4}/gi, '').trim();
    const away       = opp.replace(/\\u[0-9a-f]{4}/gi, '').trim();
    const market_raw = phrase.replace(/\\u[0-9a-f]{4}/gi, '').trim();
    const oddsRaw    = (html.match(/"currentRawOdd":([\d.]+)/) || [])[1];
    const odds       = oddsRaw ? parseFloat(oddsRaw) : null;
    return [{ home, away, market_raw, odds }];
  },
};
