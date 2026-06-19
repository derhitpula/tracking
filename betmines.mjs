#!/usr/bin/env node
// BetMines Daily-Bets Collector & Tracker
// -----------------------------------------------------------------------------
// Sammelt die täglichen Kombi-Tipps von https://betmines.com/daily-bets-football
// (dailyDouble = 2 Spiele, dailyRisk = 3 Spiele), speichert sie in einer lokalen
// SQLite-Datenbank und wertet Trefferquote / ROI über die Zeit aus.
//
// Keine externen Pakete nötig: nutzt Node-builtin fetch + node:sqlite.
//
// Ergebnisse: pro Tipp wird die Match-Seite-URL aus der fixture_id gebaut
//   (https://betmines.com/matches/predictions-<slug>_<fixtureId>; der Slug ist
//   egal, nur die ID zählt). Diese Seite bleibt nach dem Spiel bestehen und
//   liefert den Endstand (ftScore/htScore). Über/Unter/GG/1X2 wird daraus
//   SELBST berechnet -> unabhängig vom Mitternachts-Rollover der Daily-Bets-Seite.
//
// Befehle:
//   node betmines.mjs collect    Tipps von heute holen & speichern (Default)
//   node betmines.mjs results    Offene Tipps: Match-Seiten abrufen, Ergebnis berechnen
//   node betmines.mjs update     collect + results in einem Lauf
//   node betmines.mjs report     Auswertung: Trefferquote, ROI, Aufschlüsselung
//   node betmines.mjs list [--pending|--date YYYY-MM-DD]   Gespeicherte Tipps zeigen
//   node betmines.mjs raw        Roh-JSON der aktuellen Seite ausgeben (Debug)
// -----------------------------------------------------------------------------

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = 'https://betmines.com/daily-bets-football';
const MATCH_BASE = 'https://betmines.com/matches/predictions-';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'betmines.db');

// Match-Seiten-URL aus Teamnamen + fixture_id (Slug ist kosmetisch, nur ID zählt)
const slugify = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'match';
const matchUrl = (b) => `${MATCH_BASE}${slugify(b.home)}-${slugify(b.away)}_${b.fixture_id}`;

// --- Tipp-Code -> lesbares Label -------------------------------------------
const TIP_LABELS = {
  '1': 'Heimsieg (1)', 'X': 'Unentschieden (X)', '2': 'Auswärtssieg (2)',
  '1X': 'Heim oder X (1X)', '12': 'Heim oder Ausw. (12)', 'X2': 'X oder Ausw. (X2)',
  O05: 'Über 0.5 Tore', O15: 'Über 1.5 Tore', O25: 'Über 2.5 Tore',
  O35: 'Über 3.5 Tore', O45: 'Über 4.5 Tore',
  U05: 'Unter 0.5 Tore', U15: 'Unter 1.5 Tore', U25: 'Unter 2.5 Tore',
  U35: 'Unter 3.5 Tore', U45: 'Unter 4.5 Tore',
  GG: 'Beide treffen (GG)', NG: 'Kein beide-treffen (NG)',
  O05HT: 'Über 0.5 Tore (HZ)', O15HT: 'Über 1.5 Tore (HZ)',
  U05HT: 'Unter 0.5 Tore (HZ)', U15HT: 'Unter 1.5 Tore (HZ)',
};
const tipLabel = (c) => TIP_LABELS[c] || c;

// --- Status-Code -> Ergebnis ------------------------------------------------
// 0 = offen (bestätigt: alle NS-Spiele haben 0). Die übrigen Codes folgen der
// üblichen BetMines-Konvention; der report-Befehl gleicht sie gegen die
// autoritativen Combo-Felder (winningNbMatches/lostNbMatches) ab und warnt bei
// Abweichung -> die Auswertung ist damit selbst-validierend.
function legResult(status) {
  switch (status) {
    case 0: return 'pending';
    case 1: return 'won';
    case 2: return 'lost';
    case 3:
    case 4: return 'void';
    default: return `unknown(${status})`;
  }
}

// Ergebnis eines Tipps: bevorzugt das selbst berechnete (aus Endstand der
// Match-Seite), sonst BetMines' eigener Status als Rückfall.
function resultOf(b) {
  if (b.calc_result === 'won' || b.calc_result === 'lost' || b.calc_result === 'void') return b.calc_result;
  return legResult(b.status);
}

// --- HTTP: erst native fetch, sonst curl-Fallback ---------------------------
async function fetchHtml(url = URL) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (res.ok) {
      const txt = await res.text();
      if (txt.includes('window.__NUXT__')) return txt;
    }
  } catch { /* fällt auf curl zurück */ }
  // Fallback: curl (umgeht ggf. TLS-/Bot-Filter, die native fetch blocken)
  return execFileSync('curl', ['-s', '-L', '-A', UA, '-H', 'Accept: text/html',
    '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// --- Auf der Match-Seite das Haupt-Fixture per ID finden ---------------------
function findFixtureById(nuxt, id) {
  let fallback = null;
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 10 || seen.has(o)) return null;
    seen.add(o);
    if (o.localTeam && o.visitorTeam && ('ftScore' in o || 'timeStatus' in o)) {
      if (o.id === id) return o;          // exakter Treffer
      fallback ??= o;                      // erstes Spiel-Fixture als Reserve
    }
    for (const k of Object.keys(o)) { const r = walk(o[k], depth + 1); if (r) return r; }
    return null;
  };
  return walk(nuxt, 0) || fallback;
}

// --- Endstand einer Match-Seite holen ---------------------------------------
async function fetchResult(bet) {
  const html = await fetchHtml(matchUrl(bet));
  const fx = findFixtureById(parseNuxt(html), bet.fixture_id);
  if (!fx) return null;
  const finished = fx.matchEndend === true ||
    ['FT', 'AET', 'FT_PEN', 'AWARDED'].includes(fx.timeStatus);
  const parse = (s) => {
    const m = typeof s === 'string' && s.match(/^(\d+)\s*-\s*(\d+)$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const ft = parse(fx.ftScore) ||
    (fx.localTeamScore != null && fx.visitorTeamScore != null
      ? [Number(fx.localTeamScore), Number(fx.visitorTeamScore)] : null);
  const ht = parse(fx.htScore);
  return { finished, timeStatus: fx.timeStatus ?? null, ft, ht };
}

// --- Tipp gegen den Endstand auswerten -> 'won' | 'lost' | 'void' | null -----
function evalTip(tip, ft, ht) {
  if (!ft) return null;
  const [h, a] = ft;
  let m;
  // Über/Unter X.5 (Voll- oder Halbzeit per HT-Suffix)
  if ((m = tip.match(/^O([0-4])5(HT)?$/))) {
    const sc = m[2] ? ht : ft; if (!sc) return null;
    return sc[0] + sc[1] > Number(m[1]) + 0.5 ? 'won' : 'lost';
  }
  if ((m = tip.match(/^U([0-4])5(HT)?$/))) {
    const sc = m[2] ? ht : ft; if (!sc) return null;
    return sc[0] + sc[1] < Number(m[1]) + 0.5 ? 'won' : 'lost';
  }
  switch (tip) {
    case 'GG': return h > 0 && a > 0 ? 'won' : 'lost';
    case 'NG': return h > 0 && a > 0 ? 'lost' : 'won';
    case '1': return h > a ? 'won' : 'lost';
    case 'X': return h === a ? 'won' : 'lost';
    case '2': return a > h ? 'won' : 'lost';
    case '1X': return h >= a ? 'won' : 'lost';
    case 'X2': return a >= h ? 'won' : 'lost';
    case '12': return h !== a ? 'won' : 'lost';
    default: return null; // unbekannter Markt -> nicht selbst auswertbar
  }
}

// --- Nuxt-SSR-Payload aus dem HTML extrahieren ------------------------------
function parseNuxt(html) {
  const m = html.match(/window\.__NUXT__=(.*?);<\/script>/s);
  if (!m) throw new Error('window.__NUXT__ nicht im HTML gefunden (Seitenstruktur geändert?)');
  // Das Payload ist eine selbstaufrufende JS-Funktion, kein reines JSON.
  // new Function wertet sie isoliert aus (Zugriff nur auf globale Builtins).
  const fn = new Function('window', `return (${m[1]});`);
  return fn({});
}

// --- Aus dem Payload die beiden Tages-Kombis extrahieren --------------------
function extractCombos(nuxt) {
  const bb = nuxt?.state?.best_bets;
  if (!bb) throw new Error('best_bets fehlt im Payload');
  const out = [];
  for (const [type, key] of [['double', 'dailyDouble'], ['risk', 'dailyRisk']]) {
    const g = bb[key];
    if (!g || !Array.isArray(g.fixtures)) continue;
    const legs = g.fixtures.map((f) => {
      const fx = f.fixture || {};
      const num = (v) => (v == null || v === '' ? null : Number(v));
      return {
        bet_id: f.id,
        fixture_id: fx.id ?? null,
        tip: f.betResult,
        odds: num(f.betResultQuote),
        status: f.betResultStatus ?? 0,
        live: f.liveBet ? 1 : 0,
        home: fx.localTeam?.name ?? null,
        away: fx.visitorTeam?.name ?? null,
        league: fx.league?.name ?? null,
        country: fx.league?.country?.name ?? null,
        kickoff: fx.dateTime ?? null,
        home_score: num(fx.localTeamScore ?? fx.localScore ?? null),
        away_score: num(fx.visitorTeamScore ?? fx.visitorScore ?? null),
      };
    });
    out.push({
      combo_id: g.id,
      type,
      quote: g.quote == null ? null : Number(g.quote),
      nb_matches: g.nbMatches ?? legs.length,
      winning_nb: g.winningNbMatches ?? 0,
      lost_nb: g.lostNbMatches ?? 0,
      status: g.status ?? 0,
      winning: g.winning ? 1 : 0,
      created_dt: g.createdDateTime ?? null,
      date_first: g.dateFirstMatch ?? null,
      date_last: g.dateLastMatch ?? null,
      legs,
    });
  }
  return out;
}

// --- DB-Setup ---------------------------------------------------------------
function openDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS combos (
      combo_id    INTEGER PRIMARY KEY,
      type        TEXT,
      match_date  TEXT,        -- Tag des ersten Spiels (YYYY-MM-DD)
      quote       REAL,
      nb_matches  INTEGER,
      winning_nb  INTEGER,
      lost_nb     INTEGER,
      status      INTEGER,
      winning     INTEGER,
      created_dt  TEXT,
      date_first  TEXT,
      date_last   TEXT,
      first_seen  TEXT,
      last_seen   TEXT
    );
    CREATE TABLE IF NOT EXISTS bets (
      bet_id      INTEGER PRIMARY KEY,
      combo_id    INTEGER,
      fixture_id  INTEGER,
      tip         TEXT,
      odds        REAL,
      status      INTEGER,
      live        INTEGER,
      home        TEXT,
      away        TEXT,
      league      TEXT,
      country     TEXT,
      kickoff     TEXT,
      home_score  INTEGER,
      away_score  INTEGER,
      first_seen  TEXT,
      last_seen   TEXT,
      FOREIGN KEY (combo_id) REFERENCES combos(combo_id)
    );
  `);
  // Migration: Spalten für Match-Seite & selbst berechnetes Ergebnis nachrüsten
  const cols = new Set(db.prepare('PRAGMA table_info(bets)').all().map((r) => r.name));
  const add = (name, type) => { if (!cols.has(name)) db.exec(`ALTER TABLE bets ADD COLUMN ${name} ${type}`); };
  add('match_url', 'TEXT');      // gespeicherter Link zur Spielseite
  add('time_status', 'TEXT');    // FT / NS / ... von der Match-Seite
  add('ft_home', 'INTEGER');     // Endstand Heim
  add('ft_away', 'INTEGER');     // Endstand Auswärts
  add('ht_home', 'INTEGER');     // Halbzeit Heim
  add('ht_away', 'INTEGER');     // Halbzeit Auswärts
  add('calc_result', 'TEXT');    // selbst berechnet: won/lost/void
  add('result_at', 'TEXT');      // wann das Ergebnis ermittelt wurde
  return db;
}

const nowIso = () => new Date().toISOString();
const dayOf = (iso) => (iso ? iso.slice(0, 10) : null);

// --- Speichern / Aktualisieren ----------------------------------------------
function save(db, combos) {
  const upCombo = db.prepare(`
    INSERT INTO combos (combo_id,type,match_date,quote,nb_matches,winning_nb,lost_nb,
      status,winning,created_dt,date_first,date_last,first_seen,last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(combo_id) DO UPDATE SET
      quote=excluded.quote, nb_matches=excluded.nb_matches, winning_nb=excluded.winning_nb,
      lost_nb=excluded.lost_nb, status=excluded.status, winning=excluded.winning,
      date_first=excluded.date_first, date_last=excluded.date_last,
      last_seen=excluded.last_seen`);
  const upBet = db.prepare(`
    INSERT INTO bets (bet_id,combo_id,fixture_id,tip,odds,status,live,home,away,league,
      country,kickoff,home_score,away_score,match_url,first_seen,last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(bet_id) DO UPDATE SET
      odds=excluded.odds, status=excluded.status, live=excluded.live,
      home_score=excluded.home_score, away_score=excluded.away_score,
      match_url=excluded.match_url, last_seen=excluded.last_seen`);

  let newCombos = 0, newBets = 0, settled = 0;
  const ts = nowIso();
  const exists = (id) => db.prepare('SELECT 1 FROM combos WHERE combo_id=?').get(id);
  const betExists = (id) => db.prepare('SELECT status FROM bets WHERE bet_id=?').get(id);

  for (const c of combos) {
    if (!exists(c.combo_id)) newCombos++;
    upCombo.run(c.combo_id, c.type, dayOf(c.date_first), c.quote, c.nb_matches,
      c.winning_nb, c.lost_nb, c.status, c.winning, c.created_dt, c.date_first,
      c.date_last, ts, ts);
    for (const b of c.legs) {
      const prev = betExists(b.bet_id);
      if (!prev) newBets++;
      else if (prev.status === 0 && b.status !== 0) settled++;
      upBet.run(b.bet_id, c.combo_id, b.fixture_id, b.tip, b.odds, b.status, b.live,
        b.home, b.away, b.league, b.country, b.kickoff, b.home_score, b.away_score,
        b.fixture_id ? matchUrl(b) : null, ts, ts);
    }
  }
  return { newCombos, newBets, settled };
}

// --- Befehl: collect / update ----------------------------------------------
async function cmdCollect() {
  const html = await fetchHtml();
  const combos = extractCombos(parseNuxt(html));
  const db = openDb();
  const res = save(db, combos);

  console.log(`\nAbgerufen: ${combos.length} Kombis am ${new Date().toLocaleString('de-DE')}`);
  for (const c of combos) {
    console.log(`\n  ${c.type === 'double' ? 'Daily Double' : 'Daily Risk'}  ` +
      `(Kombiquote ${c.quote})  [${dayOf(c.date_first)}]`);
    for (const b of c.legs) {
      console.log(`    ${b.home} vs ${b.away}`);
      console.log(`      ${tipLabel(b.tip)} @ ${b.odds}  ·  ${b.league}  ·  ` +
        `${b.kickoff ? new Date(b.kickoff).toLocaleString('de-DE') : '?'}  ·  ${legResult(b.status)}`);
    }
  }
  console.log(`\nGespeichert -> neue Kombis: ${res.newCombos}, neue Tipps: ${res.newBets}, ` +
    `frisch abgerechnet: ${res.settled}`);
  console.log(`DB: ${DB_PATH}`);
  db.close();
}

// --- Befehl: results --------------------------------------------------------
// Holt für offene Tipps (Anstoß in der Vergangenheit, noch kein calc_result)
// die Match-Seite und berechnet das Ergebnis selbst aus dem Endstand.
async function cmdResults() {
  const db = openDb();
  const now = new Date();
  const open = db.prepare(`
    SELECT * FROM bets
    WHERE calc_result IS NULL AND fixture_id IS NOT NULL
    ORDER BY kickoff`).all()
    .filter((b) => !b.kickoff || new Date(b.kickoff) <= now); // nur angestoßene Spiele
  if (!open.length) { console.log('Keine offenen Tipps mit angestoßenem Spiel.'); db.close(); return; }

  const upd = db.prepare(`UPDATE bets SET time_status=?, ft_home=?, ft_away=?,
    ht_home=?, ht_away=?, calc_result=?, result_at=? WHERE bet_id=?`);
  let done = 0, waiting = 0, failed = 0;
  console.log(`Prüfe ${open.length} offene Tipp(s) auf Ergebnisse …\n`);
  for (const b of open) {
    let r;
    try { r = await fetchResult(b); }
    catch (e) { console.log(`  ✗ ${b.home} vs ${b.away}: ${e.message}`); failed++; await sleep(800); continue; }
    if (!r) { console.log(`  ? ${b.home} vs ${b.away}: Fixture nicht gefunden`); failed++; await sleep(800); continue; }
    if (!r.finished || !r.ft) {
      db.prepare('UPDATE bets SET time_status=? WHERE bet_id=?').run(r.timeStatus, b.bet_id);
      console.log(`  … ${b.home} vs ${b.away}: noch nicht beendet (${r.timeStatus ?? '?'})`);
      waiting++; await sleep(800); continue;
    }
    const res = evalTip(b.tip, r.ft, r.ht);
    upd.run(r.timeStatus, r.ft[0], r.ft[1], r.ht?.[0] ?? null, r.ht?.[1] ?? null,
      res, nowIso(), b.bet_id);
    console.log(`  ✓ ${b.home} ${r.ft[0]}-${r.ft[1]} ${b.away} · ${tipLabel(b.tip)} -> ` +
      `${(res ?? 'unbekannt').toUpperCase()}`);
    done++; await sleep(800); // höflich: kurze Pause zwischen Seitenaufrufen
  }
  console.log(`\nFertig: ${done} ausgewertet, ${waiting} noch offen, ${failed} fehlgeschlagen.`);
  db.close();
}

// --- Befehl: report ---------------------------------------------------------
function pct(n, d) { return d ? `${(100 * n / d).toFixed(1)}%` : '–'; }
function signed(n) { return (n >= 0 ? '+' : '') + n.toFixed(2); }

function cmdReport() {
  const db = openDb();
  const combos = db.prepare('SELECT * FROM combos ORDER BY match_date').all();
  const bets = db.prepare('SELECT * FROM bets').all();
  if (!combos.length) { console.log('Noch keine Daten. Erst `node betmines.mjs collect` ausführen.'); db.close(); return; }

  const betsByCombo = new Map();
  for (const b of bets) {
    if (!betsByCombo.has(b.combo_id)) betsByCombo.set(b.combo_id, []);
    betsByCombo.get(b.combo_id).push(b);
  }

  // --- Einzelwetten (jeder Tipp einzeln, 1 Einheit Einsatz) ---
  const leg = { won: 0, lost: 0, void: 0, pending: 0, stake: 0, ret: 0 };
  const byTip = new Map();      // Markt -> Statistik
  const byLeague = new Map();
  for (const b of bets) {
    const r = resultOf(b);
    leg[r] = (leg[r] ?? 0) + 1;
    const slot = (map, k) => { if (!map.has(k)) map.set(k, { won: 0, lost: 0, void: 0, pending: 0, stake: 0, ret: 0 }); return map.get(k); };
    const t = slot(byTip, b.tip), lg = slot(byLeague, b.league || '?');
    t[r]++; lg[r]++;
    if (r === 'won' || r === 'lost' || r === 'void') {
      const ret = r === 'won' ? (b.odds || 0) : r === 'void' ? 1 : 0;
      leg.stake++; leg.ret += ret;
      t.stake++; t.ret += ret; lg.stake++; lg.ret += ret;
    }
  }

  // --- Kombis (Akkumulator, 1 Einheit Einsatz pro Slip) ---
  const combo = { won: 0, lost: 0, pending: 0, stake: 0, ret: 0 };
  const byType = { double: { won: 0, lost: 0, pending: 0, stake: 0, ret: 0 }, risk: { won: 0, lost: 0, pending: 0, stake: 0, ret: 0 } };
  const warnings = [];
  for (const c of combos) {
    const legs = betsByCombo.get(c.combo_id) || [];
    const results = legs.map((b) => resultOf(b));
    const anyPending = results.some((r) => r === 'pending' || String(r).startsWith('unknown'));
    const tally = byType[c.type] || combo;
    if (anyPending) { combo.pending++; tally.pending++; continue; }
    // Akkumulator: gewonnen nur, wenn jedes Leg trifft (void zählt als neutral)
    const isWin = results.every((r) => r === 'won' || r === 'void');
    const ret = isWin ? (c.quote || 0) : 0;
    combo.stake++; combo.ret += ret; combo[isWin ? 'won' : 'lost']++;
    tally.stake++; tally.ret += ret; tally[isWin ? 'won' : 'lost']++;
    // Cross-Check: selbst berechnete Sieger-Legs vs. BetMines' winningNbMatches
    const wonLegs = results.filter((r) => r === 'won').length;
    if (c.status !== 0 && c.winning_nb != null && wonLegs !== c.winning_nb) {
      warnings.push(`Kombi ${c.combo_id} (${c.match_date}): selbst berechnete Sieger-Legs ${wonLegs} ≠ BetMines winningNbMatches ${c.winning_nb}`);
    }
  }

  const line = '─'.repeat(64);
  console.log(`\n${line}\n  BETMINES TRACKER – AUSWERTUNG\n${line}`);
  const dates = combos.map((c) => c.match_date).filter(Boolean).sort();
  console.log(`  Zeitraum: ${dates[0] ?? '?'} … ${dates[dates.length - 1] ?? '?'}   ` +
    `Kombis: ${combos.length}   Einzeltipps: ${bets.length}`);

  console.log(`\n  ── KOMBIS (Akkumulator, 1 Einheit/Slip) ────────────────────`);
  const cSettled = combo.won + combo.lost;
  console.log(`  abgerechnet ${cSettled} · offen ${combo.pending}`);
  console.log(`  Treffer: ${combo.won}/${cSettled} (${pct(combo.won, cSettled)})`);
  console.log(`  Einsatz ${combo.stake.toFixed(2)} · Rückfluss ${combo.ret.toFixed(2)} · ` +
    `Gewinn ${signed(combo.ret - combo.stake)} · ROI ${combo.stake ? signed(100 * (combo.ret - combo.stake) / combo.stake) + '%' : '–'}`);
  for (const [k, v] of Object.entries(byType)) {
    const s = v.won + v.lost;
    if (!s && !v.pending) continue;
    console.log(`    ${k === 'double' ? 'Double' : 'Risk  '}: ${v.won}/${s} Treffer (${pct(v.won, s)}) · ` +
      `ROI ${v.stake ? signed(100 * (v.ret - v.stake) / v.stake) + '%' : '–'} · offen ${v.pending}`);
  }

  console.log(`\n  ── EINZELTIPPS (1 Einheit/Tipp) ────────────────────────────`);
  const lSettled = leg.won + leg.lost + leg.void;
  console.log(`  abgerechnet ${lSettled} · offen ${leg.pending}`);
  console.log(`  Treffer: ${leg.won}/${leg.won + leg.lost} (${pct(leg.won, leg.won + leg.lost)})` +
    (leg.void ? ` · void ${leg.void}` : ''));
  console.log(`  Einsatz ${leg.stake.toFixed(2)} · Rückfluss ${leg.ret.toFixed(2)} · ` +
    `Gewinn ${signed(leg.ret - leg.stake)} · ROI ${leg.stake ? signed(100 * (leg.ret - leg.stake) / leg.stake) + '%' : '–'}`);

  const tipRows = [...byTip.entries()]
    .map(([k, v]) => ({ k, s: v.won + v.lost, ...v }))
    .filter((r) => r.s > 0).sort((a, b) => b.s - a.s);
  if (tipRows.length) {
    console.log(`\n  nach Markt:`);
    for (const r of tipRows) {
      console.log(`    ${tipLabel(r.k).padEnd(22)} ${String(r.won).padStart(3)}/${String(r.s).padEnd(3)} ` +
        `(${pct(r.won, r.s).padStart(6)})  ROI ${r.stake ? signed(100 * (r.ret - r.stake) / r.stake) + '%' : '–'}`);
    }
  }

  if (warnings.length) {
    console.log(`\n  ⚠ Status-Mapping prüfen (${warnings.length}):`);
    for (const w of warnings.slice(0, 5)) console.log(`    ${w}`);
    console.log(`    → ggf. legResult() in betmines.mjs an die BetMines-Codes anpassen.`);
  }
  console.log(line + '\n');
  db.close();
}

// --- Befehl: list -----------------------------------------------------------
function cmdList(args) {
  const db = openDb();
  const onlyPending = args.includes('--pending');
  const dIdx = args.indexOf('--date');
  const date = dIdx >= 0 ? args[dIdx + 1] : null;
  let combos = db.prepare('SELECT * FROM combos ORDER BY match_date DESC').all();
  if (date) combos = combos.filter((c) => c.match_date === date);
  for (const c of combos) {
    const legs = db.prepare('SELECT * FROM bets WHERE combo_id=?').all(c.combo_id);
    const res = legs.map((b) => resultOf(b));
    const settled = res.every((r) => r === 'won' || r === 'lost' || r === 'void');
    if (onlyPending && settled) continue;
    const state = !settled ? 'offen' : (res.every((r) => r !== 'lost') ? 'GEWONNEN' : 'verloren');
    console.log(`\n[${c.match_date}] ${c.type === 'double' ? 'Double' : 'Risk'} @${c.quote}  – ${state}`);
    legs.forEach((b, i) => {
      const sc = b.ft_home != null ? ` (${b.ft_home}-${b.ft_away})` : '';
      console.log(`   ${b.home} vs ${b.away}${sc} · ${tipLabel(b.tip)} @${b.odds} · ${res[i]}`);
    });
  }
  if (!combos.length) console.log('Keine Einträge.');
  db.close();
}

// --- Befehl: raw ------------------------------------------------------------
async function cmdRaw() {
  const html = await fetchHtml();
  console.log(JSON.stringify(extractCombos(parseNuxt(html)), null, 2));
}

// --- Dispatch ---------------------------------------------------------------
const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case undefined:
    case 'collect': await cmdCollect(); break;
    case 'results': await cmdResults(); break;
    case 'update': await cmdCollect(); await cmdResults(); break;
    case 'report': cmdReport(); break;
    case 'list': cmdList(args); break;
    case 'raw': await cmdRaw(); break;
    default:
      console.log('Befehle: collect | results | update | report | list [--pending|--date YYYY-MM-DD] | raw');
  }
} catch (e) {
  console.error('Fehler:', e.message);
  process.exit(1);
}
