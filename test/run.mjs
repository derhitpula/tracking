// Adapter offline gegen eine gespeicherte Fixture testen:
//   node test/run.mjs <adapterDateiname-ohne-.mjs> <fixtureDatei>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeMarket } from '../lib/markets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [adapterName, fixture] = process.argv.slice(2);
const adapter = (await import(`../adapters/${adapterName}.mjs`)).default;
const html = readFileSync(join(__dirname, 'fixtures', fixture), 'utf8');
const tips = await adapter.parse(html);
console.log(`${adapter.id}: ${tips.length} Tipp(s)\n`);
for (const t of tips) {
  const code = normalizeMarket(t.market_raw, t.home, t.away);
  console.log(`  ${t.home} vs ${t.away}  [${t.league || '-'}]`);
  console.log(`    "${t.market_raw}" -> ${code || 'NICHT auswertbar'} @${t.odds ?? '?'}` +
    (t.kickoff ? ` · ${t.kickoff}` : '') + (t.slip_ref ? ` · slip:${t.slip_ref}` : ''));
}
