// Verschiebt Tips von einem falsch datierten Match auf das korrekte und löscht
// den Duplikat-Eintrag.
//   node scripts/fix_match_date.mjs <heim-substr> <ausw-substr> <falsch-datum> <richtig-datum>
//   z. B.  node scripts/fix_match_date.mjs Germany Ivoire 2026-06-27 2026-06-20
import { openDb } from '../lib/db.mjs';

const [home, away, wrongDate, rightDate] = process.argv.slice(2);
if (!home || !away || !wrongDate || !rightDate) {
  console.error('Aufruf: node scripts/fix_match_date.mjs <heim> <ausw> <falsches-datum> <richtiges-datum>');
  process.exit(1);
}
const db = openDb();

const wrong = db.prepare(
  'SELECT * FROM matches WHERE home_team LIKE ? AND away_team LIKE ? AND match_date=?')
  .get(`%${home}%`, `%${away}%`, wrongDate);
const right = db.prepare(
  'SELECT * FROM matches WHERE home_team LIKE ? AND away_team LIKE ? AND match_date=?')
  .get(`%${home}%`, `%${away}%`, rightDate);

if (!wrong) { console.log(`Kein Match für ${wrongDate} gefunden.`); db.close(); process.exit(0); }
if (!right) { console.log(`Kein Ziel-Match für ${rightDate} gefunden.`); db.close(); process.exit(0); }

console.log(`Falsch: [${wrong.id}] ${wrong.home_team} vs ${wrong.away_team} ${wrong.match_date}`);
console.log(`Richtig: [${right.id}] ${right.home_team} vs ${right.away_team} ${right.match_date}`);

// Tips und raw_tips umhängen
const tips = db.prepare('SELECT id FROM tips WHERE match_id=?').all(wrong.id);
db.prepare('UPDATE tips SET match_id=? WHERE match_id=?').run(right.id, wrong.id);
console.log(`${tips.length} Tip(s) auf Match ${right.id} umgehängt.`);

// raw_tips source_id umhängen (für Prune-Logik)
db.prepare('UPDATE raw_tips SET source_id=source_id WHERE id IN (SELECT raw_tip_id FROM tips WHERE match_id=?)').run(right.id);

// Falschen Match löschen
db.prepare('DELETE FROM matches WHERE id=?').run(wrong.id);
console.log(`Match ${wrong.id} (${wrongDate}) gelöscht.`);
db.close();
