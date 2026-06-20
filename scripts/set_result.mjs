// Manuell ein Spielergebnis setzen und danach neu abrechnen.
//   node scripts/set_result.mjs <heim-substring> <ausw-substring> <heim-tore> <ausw-tore>
//   z. B.  node scripts/set_result.mjs Germany Ivory 2 1
import { openDb } from '../lib/db.mjs';
import * as repo from '../lib/repo.mjs';
import { settleTip, profitUnits } from '../lib/markets.mjs';

const [home, away, fhStr, faStr] = process.argv.slice(2);
if (!home || !away || fhStr == null || faStr == null) {
  console.error('Aufruf: node scripts/set_result.mjs <heim> <ausw> <heim-tore> <ausw-tore>');
  process.exit(1);
}
const fh = Number(fhStr), fa = Number(faStr);
const db = openDb();

const matches = db.prepare(
  'SELECT * FROM matches WHERE home_team LIKE ? AND away_team LIKE ?')
  .all(`%${home}%`, `%${away}%`);

if (!matches.length) { console.log('Kein passendes Spiel gefunden.'); db.close(); process.exit(0); }

for (const m of matches) {
  console.log(`${m.home_team} vs ${m.away_team} (${m.match_date}) -> ${fh}:${fa}`);
  repo.updateMatchResult(db, m.id, { status: 'finished', fh, fa, hh: null, ha: null });

  // alle offenen Tipps dieses Spiels abrechnen
  const tips = db.prepare(`SELECT t.*, s.key AS src FROM tips t
    JOIN sources s ON s.id=t.source_id
    LEFT JOIN settlements st ON st.tip_id=t.id
    WHERE t.match_id=? AND t.market_code IS NOT NULL AND st.tip_id IS NULL`).all(m.id);

  for (const t of tips) {
    const result = settleTip(t.market_code, [fh, fa]);
    if (!result) { console.log(`  [${t.src}] ${t.market_code} -> kein Settler`); continue; }
    const odds = t.odds ?? t.ref_odds;
    repo.recordSettlement(db, t.id, result, profitUnits(result, odds), 'manual');
    console.log(`  [${t.src}] ${t.market_code} @${odds ?? '–'} -> ${result} (${profitUnits(result, odds).toFixed(2)}u)`);
  }
}
db.close();
