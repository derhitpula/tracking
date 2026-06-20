// Korrigiert die Quote eines Tipps (für beendete Spiele, die die Quelle nicht
// mehr listet) und rechnet die Abrechnung neu.
//   node scripts/set_odds.mjs <source> <team-substring> <odds>
//   z. B.  node scripts/set_odds.mjs footyaccumulators Germany 2.10
import { openDb } from '../lib/db.mjs';
import * as repo from '../lib/repo.mjs';
import { settleTip, profitUnits } from '../lib/markets.mjs';

const [source, team, oddsStr] = process.argv.slice(2);
if (!source || !team || !oddsStr) {
  console.error('Aufruf: node scripts/set_odds.mjs <source> <team-substring> <odds>');
  process.exit(1);
}
const odds = Number(oddsStr);
const db = openDb();

const rows = db.prepare(`
  SELECT t.id, t.market_code, t.odds, t.ref_odds, m.home_team, m.away_team,
         m.home_goals fh, m.away_goals fa, m.ht_home hh, m.ht_away ha, m.status
  FROM tips t JOIN matches m ON m.id=t.match_id JOIN sources s ON s.id=t.source_id
  WHERE s.name=? AND (m.home_team LIKE ? OR m.away_team LIKE ?)`)
  .all(source, `%${team}%`, `%${team}%`);

if (!rows.length) { console.log('Kein passender Tipp gefunden.'); db.close(); process.exit(0); }

for (const r of rows) {
  console.log(`${r.home_team} vs ${r.away_team} · ${r.market_code} · alt @${r.odds ?? '–'} -> neu @${odds}`);
  repo.setTipOdds(db, r.id, odds);
  // Abrechnung neu, falls Spiel beendet
  if (r.status === 'finished' && r.fh != null) {
    const result = settleTip(r.market_code, [r.fh, r.fa], r.hh != null ? [r.hh, r.ha] : null);
    if (result) {
      repo.recordSettlement(db, r.id, result, profitUnits(result, odds ?? r.ref_odds), 'manual');
      console.log(`  neu abgerechnet: ${result} (${profitUnits(result, odds ?? r.ref_odds).toFixed(2)}u)`);
    }
  }
}
db.close();
