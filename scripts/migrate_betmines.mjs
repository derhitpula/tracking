// Einmal-Migration: betmines-Tipps aus dem v1-Backup (data/tips_v1_backup.db,
// altes flaches Schema) ins v2-Schema übertragen – inkl. Match, Markt-Code,
// Referenzquote und bereits bekanntem Endstand/Abrechnung.
//   node scripts/migrate_betmines.mjs
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openDb, getOrCreateSource, getOrCreateTipster, DATA_DIR } from '../lib/db.mjs';
import * as repo from '../lib/repo.mjs';
import { fromLegacy, normalizeMarket, settleTip, profitUnits } from '../lib/markets.mjs';

const backupPath = join(DATA_DIR, 'tips_v1_backup.db');
if (!existsSync(backupPath)) { console.error('Kein Backup gefunden:', backupPath); process.exit(1); }

const bk = new DatabaseSync(backupPath);
const rows = bk.prepare("SELECT * FROM tips WHERE source='betmines'").all();
console.log(`Backup: ${rows.length} betmines-Tipp(s)`);

const db = openDb();
const sid = getOrCreateSource(db, 'betmines', 'BetMines – Daily Bets', 'https://betmines.com');
const tid = getOrCreateTipster(db, sid, 'default');

let migrated = 0, settled = 0;
for (const r of rows) {
  const raw = repo.upsertRawTip(db, sid, tid, {
    home: r.home, away: r.away, market_raw: r.market_raw, odds: r.odds,
    match_date: r.match_date, kickoff: r.kickoff, league: r.league,
    slip_type: r.slip_type, slip_ref: r.slip_ref, slip_odds: r.slip_odds,
    ext_id: r.ext_id, source_url: r.source_url,
  });
  const matchId = repo.findOrCreateMatch(db, r.home, r.away, r.match_date, { kickoff: r.kickoff, league: r.league });
  const code = fromLegacy(r.market) || normalizeMarket(r.market_raw, r.home, r.away);
  const tipId = repo.upsertTip(db, { rawTipId: raw.id, sourceId: sid, tipsterId: tid,
    matchId, marketCode: code, selection: r.market_raw, odds: r.odds });
  if (r.ref_odds != null) repo.setRefOdds(db, tipId, r.ref_odds, r.ref_fixture);

  // bekannten Endstand übernehmen und abrechnen
  if (r.ft_home != null) {
    repo.updateMatchResult(db, matchId, { status: 'finished', kickoff: r.kickoff,
      fh: r.ft_home, fa: r.ft_away, hh: r.ht_home, ha: r.ht_away });
    const result = settleTip(code, [r.ft_home, r.ft_away], r.ht_home != null ? [r.ht_home, r.ht_away] : null);
    if (result) { repo.recordSettlement(db, tipId, result, profitUnits(result, r.odds ?? r.ref_odds), 'v1-backup'); settled++; }
  }
  migrated++;
}
console.log(`Migriert: ${migrated} Tipp(s), ${settled} abgerechnet.`);
db.close();
