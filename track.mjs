#!/usr/bin/env node
// Multi-Source Tipp-Tracker – CLI.
// Datenfluss: Scraper -> raw_tips -> match-mapping -> tips -> settlements.
//
//   node track.mjs daily [quelle]    voller Tagesablauf (collect+prune+enrich+odds+settle)
//   node track.mjs collect [quelle]  nur Tipps sammeln
//   node track.mjs enrich            Spiele gegen Ergebnis-API anreichern
//   node track.mjs settle            fertige Spiele auswerten
//   node track.mjs odds              Referenzquoten holen
//   node track.mjs prune             veraltete Tipps entfernen
//   node track.mjs report            Auswertung je Quelle
//   node track.mjs list [--pending] [--source x] [--date YYYY-MM-DD]
//   node track.mjs sources           verfügbare Quellen
import './lib/env.mjs';
import { openDb } from './lib/db.mjs';
import { collect, enrich, settle, fillOdds, freezeClosing, prune, daily } from './lib/pipeline.mjs';
import { marketLabel } from './lib/markets.mjs';
import { prefetchToday } from './lib/betmonitor.mjs';
import { ADAPTERS } from './adapters/index.mjs';

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '–');
const signed = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
const deDate = (iso) => { const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : '?'; };

function report(db) {
  const rows = db.prepare(`
    SELECT s.key AS src,
      SUM(CASE WHEN st.result='won'  THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN st.result='lost' THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN st.result='void' THEN 1 ELSE 0 END) AS void,
      SUM(CASE WHEN st.tip_id IS NULL THEN 1 ELSE 0 END) AS pending,
      SUM(COALESCE(st.profit_units,0)) AS profit,
      SUM(CASE WHEN st.tip_id IS NOT NULL THEN COALESCE(t.odds,0) ELSE 0 END) AS staked
    FROM tips t JOIN sources s ON s.id=t.source_id
    LEFT JOIN settlements st ON st.tip_id=t.id
    GROUP BY s.key ORDER BY (won+lost) DESC, src`).all();
  if (!rows.length) { console.log('Noch keine Daten. Erst `node track.mjs daily`.'); return; }

  const line = '─'.repeat(72);
  console.log(`\n${line}\n  TIPP-TRACKER – AUSWERTUNG JE QUELLE\n${line}`);
  console.log(`  ${'Quelle'.padEnd(22)} ${'Treffer'.padStart(9)} ${'Quote'.padStart(7)} ${'Gewinn'.padStart(9)} ${'ROI'.padStart(8)}  offen`);
  let twon = 0, tlost = 0, tprofit = 0, tsettled = 0;
  for (const r of rows) {
    const st = r.won + r.lost;
    const roi = st ? signed(100 * r.profit / st) + '%' : '–';
    console.log(`  ${r.src.padEnd(22)} ${`${r.won}/${st}`.padStart(9)} ${pct(r.won, st).padStart(7)} ${signed(r.profit).padStart(9)} ${roi.padStart(8)}  ${r.pending}`);
    twon += r.won; tlost += r.lost; tprofit += r.profit; tsettled += st;
  }
  console.log(line);
  console.log(`  ${'GESAMT'.padEnd(22)} ${`${twon}/${tsettled}`.padStart(9)} ${pct(twon, tsettled).padStart(7)} ${signed(tprofit).padStart(9)} ${(tsettled ? signed(100 * tprofit / tsettled) + '%' : '–').padStart(8)}`);
  console.log(line + '\n');
}

function list(db, args) {
  const src = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
  const pending = args.includes('--pending');
  let rows = db.prepare(`
    SELECT s.key AS src, m.home_team AS home, m.away_team AS away, m.match_date, m.kickoff,
      m.home_goals AS fh, m.away_goals AS fa, t.market_code, t.selection, t.odds,
      st.result FROM tips t
    JOIN sources s ON s.id=t.source_id
    LEFT JOIN matches m ON m.id=t.match_id
    LEFT JOIN settlements st ON st.tip_id=t.id
    ORDER BY m.match_date DESC, m.kickoff, s.key`).all();
  if (src) rows = rows.filter((r) => r.src === src);
  if (date) rows = rows.filter((r) => r.match_date === date);
  if (pending) rows = rows.filter((r) => !r.result);
  for (const r of rows) {
    const sc = r.fh != null ? ` (${r.fh}-${r.fa})` : '';
    const lbl = r.market_code ? marketLabel(r.market_code) : (r.selection || '?');
    console.log(`[${deDate(r.match_date)}] ${r.src.padEnd(20)} ${r.home} vs ${r.away}${sc} · ${lbl}${r.odds ? ' @' + r.odds : ''} · ${r.result || 'pending'}`);
  }
  if (!rows.length) console.log('Keine Einträge.');
}

function sources() {
  console.log('Verfügbare Quellen:');
  for (const a of ADAPTERS) console.log(`  ${a.id.padEnd(22)} ${a.name}`);
}

const [cmd, ...args] = process.argv.slice(2);
const db = openDb();
try {
  switch (cmd) {
    case undefined:
    case 'daily':   await daily(db, args[0]); break;
    case 'collect': await collect(db, args[0]); break;
    case 'enrich':  await enrich(db); break;
    case 'settle':  settle(db); break;
    case 'odds':    await fillOdds(db); break;
    case 'closing': freezeClosing(db); break;
    case 'prune':   prune(db, {}); break;
    case 'prefetch': await prefetchToday(); console.log('Betmonitor gecacht.'); break;
    case 'report':  report(db); break;
    case 'list':    list(db, args); break;
    case 'sources': sources(); break;
    default: console.log('Befehle: daily | collect | enrich | settle | odds | prune | report | list | sources');
  }
} catch (e) { console.error('Fehler:', e.message); process.exitCode = 1; }
finally { db.close(); }
