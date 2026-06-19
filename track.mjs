#!/usr/bin/env node
// Multi-Source Tipp-Tracker
// -----------------------------------------------------------------------------
// Sammelt tägliche Fußball-Tipps von mehreren Seiten in eine gemeinsame DB und
// wertet sie aus. Ergebnisse: BetMines über seine Match-Seiten, alle anderen
// über eine unabhängige Ergebnis-API (results.mjs).
//
//   node track.mjs collect [quelle]   Tipps sammeln (alle oder eine Quelle)
//   node track.mjs results            offene Tipps: Endstände holen & auswerten
//   node track.mjs update [quelle]     collect + results
//   node track.mjs report             Auswertung mit Quellen-Vergleich
//   node track.mjs list [--source x] [--date YYYY-MM-DD] [--pending]
//   node track.mjs sources            verfügbare Quellen anzeigen
// -----------------------------------------------------------------------------
import './lib/env.mjs'; // .env laden (für nativen Betrieb ohne Docker)
import { openDb, upsertTip, dayOf, nowIso } from './lib/db.mjs';
import { fetchHtml, sleep } from './lib/fetch.mjs';
import { normalizeMarket, evalTip, tipLabel } from './lib/markets.mjs';
import { today } from './lib/parse.mjs';
import { resolveResult } from './lib/results.mjs';
import { ADAPTERS } from './adapters/index.mjs';

const byId = (id) => ADAPTERS.find((a) => a.id === id);

// --- collect ----------------------------------------------------------------
async function collect(sourceFilter) {
  const db = openDb();
  const list = sourceFilter ? [byId(sourceFilter)].filter(Boolean) : ADAPTERS;
  if (!list.length) { console.log(`Unbekannte Quelle: ${sourceFilter}`); db.close(); return; }
  for (const a of list) {
    process.stdout.write(`• ${a.id.padEnd(22)} `);
    try {
      const html = a.fetch ? await a.fetch() : await fetchHtml(a.url);
      const tips = (await a.parse(html)) || [];
      let n = 0;
      for (const t of tips) {
        const norm = normalizeMarket(t.market_raw, t.home, t.away);
        upsertTip(db, {
          ...t, source: a.id, market: t.market ?? norm.code,
          market_raw: t.market_raw ?? norm.raw,
          match_date: t.match_date || dayOf(t.kickoff) || today(),
        });
        n++;
      }
      console.log(`${n} Tipp(s)`);
    } catch (e) { console.log(`FEHLER: ${e.message}`); }
    await sleep(600);
  }
  db.close();
}

// --- results ----------------------------------------------------------------
async function results() {
  const db = openDb();
  const open = db.prepare(`SELECT * FROM tips
    WHERE (result IS NULL OR result='pending') AND market IS NOT NULL
    ORDER BY match_date, kickoff`).all()
    .filter((t) => !t.kickoff || new Date(t.kickoff) <= new Date());
  if (!open.length) { console.log('Keine offenen, auswertbaren Tipps mit angestoßenem Spiel.'); db.close(); return; }

  const upd = db.prepare(`UPDATE tips SET ft_home=?, ft_away=?, ht_home=?, ht_away=?,
    result=?, result_src=?, settled_at=? WHERE id=?`);
  let done = 0, wait = 0, fail = 0;
  console.log(`Prüfe ${open.length} offene Tipp(s) …\n`);
  for (const t of open) {
    const a = byId(t.source);
    let r = null;
    try { r = await resolveResult(t, a); }
    catch (e) { console.log(`  ✗ ${t.home} vs ${t.away}: ${e.message}`); fail++; continue; }
    if (!r || !r.ft) {
      console.log(`  … ${t.home} vs ${t.away}: noch kein Endstand`); wait++; continue;
    }
    const res = evalTip(t.market, r.ft, r.ht) ?? 'unknown';
    upd.run(r.ft[0], r.ft[1], r.ht?.[0] ?? null, r.ht?.[1] ?? null, res, r.src, nowIso(), t.id);
    console.log(`  ✓ [${t.source}] ${t.home} ${r.ft[0]}-${r.ft[1]} ${t.away} · ${tipLabel(t.market)} -> ${res.toUpperCase()}`);
    done++;
  }
  console.log(`\nFertig: ${done} ausgewertet, ${wait} offen, ${fail} fehlgeschlagen.`);
  db.close();
}

// --- report -----------------------------------------------------------------
const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '–');
const signed = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
const roi = (s) => (s.stake ? signed(100 * (s.ret - s.stake) / s.stake) + '%' : '–');

function report() {
  const db = openDb();
  const rows = db.prepare('SELECT * FROM tips').all();
  if (!rows.length) { console.log('Noch keine Daten. Erst `node track.mjs collect`.'); db.close(); return; }
  const blank = () => ({ won: 0, lost: 0, void: 0, pending: 0, unknown: 0, stake: 0, ret: 0 });
  const add = (s, r, odds) => {
    s[r] = (s[r] ?? 0) + 1;
    if (r === 'won' || r === 'lost' || r === 'void') {
      s.stake++; s.ret += r === 'won' ? (odds || 0) : r === 'void' ? 1 : 0;
    }
  };
  const overall = blank(), bySource = new Map(), byMarket = new Map();
  const slot = (m, k) => { if (!m.has(k)) m.set(k, blank()); return m.get(k); };
  for (const t of rows) {
    const r = t.result || 'pending';
    add(overall, r, t.odds); add(slot(bySource, t.source), r, t.odds);
    if (t.market) add(slot(byMarket, tipLabel(t.market)), r, t.odds);
  }
  const line = '─'.repeat(70);
  console.log(`\n${line}\n  MULTI-SOURCE TIPP-TRACKER – AUSWERTUNG\n${line}`);
  const dates = rows.map((t) => t.match_date).filter(Boolean).sort();
  console.log(`  Zeitraum ${dates[0] ?? '?'} … ${dates.at(-1) ?? '?'}   Tipps gesamt: ${rows.length}`);
  const settled = overall.won + overall.lost + overall.void;
  console.log(`\n  GESAMT: abgerechnet ${settled} · offen ${overall.pending} · nicht auswertbar ${overall.unknown}`);
  console.log(`  Treffer ${overall.won}/${overall.won + overall.lost} (${pct(overall.won, overall.won + overall.lost)}) · ` +
    `Einsatz ${overall.stake.toFixed(2)} · Gewinn ${signed(overall.ret - overall.stake)} · ROI ${roi(overall)}`);

  console.log(`\n  ── NACH QUELLE ──────────────────────────────────────────────────`);
  console.log(`  ${'Quelle'.padEnd(22)} ${'Treffer'.padStart(9)} ${'Quote'.padStart(7)} ${'ROI'.padStart(8)}  offen`);
  for (const [k, s] of [...bySource].sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost))) {
    const st = s.won + s.lost;
    console.log(`  ${k.padEnd(22)} ${`${s.won}/${st}`.padStart(9)} ${pct(s.won, st).padStart(7)} ${roi(s).padStart(8)}  ${s.pending}`);
  }
  const mk = [...byMarket].map(([k, s]) => ({ k, st: s.won + s.lost, s })).filter((x) => x.st).sort((a, b) => b.st - a.st);
  if (mk.length) {
    console.log(`\n  ── NACH MARKT ───────────────────────────────────────────────────`);
    for (const { k, st, s } of mk) console.log(`  ${k.padEnd(22)} ${`${s.won}/${st}`.padStart(9)} ${pct(s.won, st).padStart(7)} ${roi(s).padStart(8)}`);
  }
  console.log(line + '\n');
  db.close();
}

// --- list -------------------------------------------------------------------
function list(args) {
  const db = openDb();
  const src = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
  const pending = args.includes('--pending');
  let rows = db.prepare('SELECT * FROM tips ORDER BY match_date DESC, source').all();
  if (src) rows = rows.filter((t) => t.source === src);
  if (date) rows = rows.filter((t) => t.match_date === date);
  if (pending) rows = rows.filter((t) => !t.result || t.result === 'pending');
  for (const t of rows) {
    const sc = t.ft_home != null ? ` (${t.ft_home}-${t.ft_away})` : '';
    const res = t.result || 'pending';
    console.log(`[${t.match_date}] ${t.source.padEnd(20)} ${t.home} vs ${t.away}${sc} · ` +
      `${t.market_raw || '?'}${t.odds ? ' @' + t.odds : ''} · ${res}`);
  }
  if (!rows.length) console.log('Keine Einträge.');
  db.close();
}

function sources() {
  console.log('Verfügbare Quellen:');
  for (const a of ADAPTERS) console.log(`  ${a.id.padEnd(22)} ${a.name}\n  ${' '.repeat(22)} ${a.url}`);
}

// --- dispatch ---------------------------------------------------------------
const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case undefined:
    case 'collect': await collect(args[0]); break;
    case 'results': await results(); break;
    case 'update': await collect(args[0]); await results(); break;
    case 'report': report(); break;
    case 'list': list(args); break;
    case 'sources': sources(); break;
    default: console.log('Befehle: collect | results | update | report | list | sources');
  }
} catch (e) { console.error('Fehler:', e.message); process.exit(1); }
