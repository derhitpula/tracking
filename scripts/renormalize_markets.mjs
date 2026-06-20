// Einmalig: market_code für Tipps nachfüllen, die noch null haben.
// Liest market_text aus raw_tips und Home/Away aus matches, schreibt in tips.
// Nützlich nach Erweiterung der normalizeMarket-Funktion (z. B. Kombi-Märkte).
//   node scripts/renormalize_markets.mjs [--source footyaccumulators]
import { openDb } from '../lib/db.mjs';
import { normalizeMarket } from '../lib/markets.mjs';

const srcFilter = process.argv.includes('--source')
  ? process.argv[process.argv.indexOf('--source') + 1] : null;

const db = openDb();
const rows = db.prepare(`
  SELECT t.id, r.market_text, r.home_text, r.away_text, s.key AS src
  FROM tips t
  JOIN raw_tips r ON r.id=t.raw_tip_id
  JOIN sources s ON s.id=t.source_id
  WHERE t.market_code IS NULL AND r.market_text IS NOT NULL`).all();

const filtered = srcFilter ? rows.filter((r) => r.src === srcFilter) : rows;
console.log(`${filtered.length} Tipps ohne market_code${srcFilter ? ` (${srcFilter})` : ''}`);

let updated = 0;
for (const r of filtered) {
  const code = normalizeMarket(r.market_text, r.home_text, r.away_text);
  if (!code) continue;
  db.prepare('UPDATE tips SET market_code=?, updated_at=datetime(\'now\') WHERE id=?').run(code, r.id);
  console.log(`  [${r.src}] ${r.home_text} vs ${r.away_text} | ${r.market_text} -> ${code}`);
  updated++;
}
console.log(`${updated} market_codes gesetzt.`);
db.close();
