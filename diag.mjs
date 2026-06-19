// Diagnose: voller collect-Pfad (fetchHtml -> Parser) für eine Quelle.
// Aufruf: node diag.mjs freetips
import './lib/env.mjs';
import { fetchHtml } from './lib/fetch.mjs';

const id = process.argv[2] || 'freetips';
const ad = (await import(`./adapters/${id}.mjs`)).default;

console.log(`Lade ${id} über collect-Pfad (fetchHtml, kann ~3 min dauern)...`);
const t = Date.now();
const h = await fetchHtml(ad.url);
const sec = Math.round((Date.now() - t) / 1000);
const cf = /Just a moment|_cf_chl/.test(h);
console.log(`fetchHtml: ${h.length}b nach ${sec}s | CF: ${cf}`);

const tips = ad.parse(h);
console.log(`Parser: ${tips.length} Tipp(s)`);
if (tips.length) {
  console.log(JSON.stringify(tips[0]));
} else {
  // Welche Marker sind im HTML? Hilft bei geänderter Struktur
  const markers = ['m-name', 'plr-name', 'betacctime', 'hostName', 'opponentName', 'expert-pick', 'tips-card__title', 'badge'];
  for (const mk of markers) {
    const n = (h.match(new RegExp(mk, 'g')) || []).length;
    if (n) console.log(`  Marker "${mk}": ${n}x`);
  }
}
