// Daten-Layer: alle Schreib-/Leseoperationen auf dem relationalen Schema.
// Hält SQL aus der Pipeline heraus.
import { nowIso, dayOf } from './db.mjs';
import { matchTeams } from './names.mjs';

const addDays = (d, n) => {
  const [y, m, dd] = String(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};

// --- raw_tips ----------------------------------------------------------------
// Roh gescrapten Tipp speichern/auffrischen. Gibt { id, isNew } zurück.
export function upsertRawTip(db, sourceId, tipsterId, t) {
  const ts = nowIso();
  const md = t.match_date || dayOf(t.kickoff);
  const info = db.prepare(`
    INSERT INTO raw_tips (source_id,tipster_id,home_text,away_text,market_text,odds,
      match_date,kickoff,league,slip_type,slip_ref,slip_odds,ext_id,source_url,first_seen,last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_id,match_date,home_text,away_text,market_text) DO UPDATE SET
      tipster_id=excluded.tipster_id,
      odds=COALESCE(excluded.odds, raw_tips.odds),
      kickoff=COALESCE(excluded.kickoff, raw_tips.kickoff),
      league=COALESCE(excluded.league, raw_tips.league),
      slip_type=excluded.slip_type, slip_ref=excluded.slip_ref, slip_odds=excluded.slip_odds,
      source_url=COALESCE(excluded.source_url, raw_tips.source_url),
      last_seen=excluded.last_seen`)
    .run(sourceId, tipsterId, t.home ?? null, t.away ?? null, t.market_raw ?? null, t.odds ?? null,
      md, t.kickoff ?? null, t.league ?? null, t.slip_type ?? 'single', t.slip_ref ?? null,
      t.slip_odds ?? null, t.ext_id ?? null, t.source_url ?? null, ts, ts);
  // lastInsertRowid ist 0/unverändert bei reinem UPDATE -> Zeile gezielt nachschlagen
  const row = db.prepare(`SELECT id, first_seen=last_seen AS isNew FROM raw_tips
    WHERE source_id=? AND match_date IS ? AND home_text IS ? AND away_text IS ? AND market_text IS ?`)
    .get(sourceId, md, t.home ?? null, t.away ?? null, t.market_raw ?? null);
  return { id: row.id, isNew: !!row.isNew };
}

// --- matches -----------------------------------------------------------------
// Spiel finden (Fuzzy über Teamnamen, ±1 Tag) oder neu anlegen. Gibt matchId.
export function findOrCreateMatch(db, home, away, matchDate, opts = {}) {
  const cands = db.prepare(
    'SELECT id, home_team AS home, away_team AS away FROM matches WHERE match_date IN (?,?,?)')
    .all(matchDate, addDays(matchDate, 1), addDays(matchDate, -1));
  for (const c of cands) {
    if (matchTeams(home, away, c).ok) {
      // vorhandenes Spiel ggf. mit Anstoßzeit/Liga anreichern
      if (opts.kickoff || opts.league) {
        db.prepare('UPDATE matches SET kickoff=COALESCE(?,kickoff), league=COALESCE(?,league), updated_at=? WHERE id=?')
          .run(opts.kickoff ?? null, opts.league ?? null, nowIso(), c.id);
      }
      return c.id;
    }
  }
  return db.prepare(`INSERT INTO matches (home_team,away_team,match_date,kickoff,league,status,updated_at)
    VALUES (?,?,?,?,?,'scheduled',?)`)
    .run(home, away, matchDate, opts.kickoff ?? null, opts.league ?? null, nowIso()).lastInsertRowid;
}

// --- tips --------------------------------------------------------------------
// Normalisierten Tipp an einen raw_tip/match hängen (idempotent per raw_tip_id).
export function upsertTip(db, t) {
  const ts = nowIso();
  db.prepare(`
    INSERT INTO tips (raw_tip_id,source_id,tipster_id,match_id,market_code,selection,odds,stake_units,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(raw_tip_id) DO UPDATE SET
      match_id=excluded.match_id, market_code=excluded.market_code, selection=excluded.selection,
      odds=COALESCE(excluded.odds, tips.odds), updated_at=excluded.updated_at`)
    .run(t.rawTipId, t.sourceId, t.tipsterId ?? null, t.matchId ?? null, t.marketCode ?? null,
      t.selection ?? null, t.odds ?? null, t.stakeUnits ?? 1, ts, ts);
  return db.prepare('SELECT id FROM tips WHERE raw_tip_id=?').get(t.rawTipId).id;
}

export function setRefOdds(db, tipId, refOdds, refFixture) {
  db.prepare('UPDATE tips SET ref_odds=?, ref_fixture=?, updated_at=? WHERE id=?')
    .run(refOdds ?? null, refFixture ?? null, nowIso(), tipId);
}

// --- matches: Anreicherung & Endstand ---------------------------------------
export function updateMatchResult(db, matchId, r) {
  db.prepare(`UPDATE matches SET api_match_id=COALESCE(?,api_match_id), provider=COALESCE(?,provider),
    kickoff=COALESCE(?,kickoff), status=?, home_goals=?, away_goals=?, ht_home=?, ht_away=?, updated_at=? WHERE id=?`)
    .run(r.apiMatchId ?? null, r.provider ?? null, r.kickoff ?? null, r.status ?? 'unknown',
      r.fh ?? null, r.fa ?? null, r.hh ?? null, r.ha ?? null, nowIso(), matchId);
}

// --- settlements -------------------------------------------------------------
export function recordSettlement(db, tipId, result, profitUnits, src) {
  db.prepare(`INSERT INTO settlements (tip_id,result,profit_units,result_src,settled_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(tip_id) DO UPDATE SET result=excluded.result, profit_units=excluded.profit_units,
      result_src=excluded.result_src, settled_at=excluded.settled_at`)
    .run(tipId, result, profitUnits, src ?? null, nowIso());
}

// --- Abfragen für die Pipeline ----------------------------------------------

// Matches die (noch) keinen Endstand haben und deren Anstoß plausibel vorbei ist.
export function matchesNeedingResult(db) {
  return db.prepare(`SELECT * FROM matches
    WHERE status != 'finished'
    ORDER BY match_date, kickoff`).all();
}

// Matches ohne bekannte Anstoßzeit (für kickoff-Backfill).
export function matchesNeedingKickoff(db) {
  return db.prepare(`SELECT * FROM matches WHERE kickoff IS NULL ORDER BY match_date`).all();
}

// Tipps mit fertigem Spiel aber ohne Abrechnung (auswertbar = market_code gesetzt).
export function tipsNeedingSettle(db) {
  return db.prepare(`SELECT t.*, m.home_goals AS fh, m.away_goals AS fa, m.ht_home AS hh, m.ht_away AS ha
    FROM tips t JOIN matches m ON m.id=t.match_id
    LEFT JOIN settlements s ON s.tip_id=t.id
    WHERE s.tip_id IS NULL AND t.market_code IS NOT NULL
      AND m.status='finished' AND m.home_goals IS NOT NULL`).all();
}

// Single-Tipps ohne Referenzquote.
export function tipsNeedingRefOdds(db) {
  return db.prepare(`SELECT t.*, m.home_team AS home, m.away_team AS away, m.match_date
    FROM tips t JOIN matches m ON m.id=t.match_id
    WHERE t.ref_odds IS NULL AND t.market_code IS NOT NULL`).all();
}

export function setMatchKickoff(db, matchId, kickoff) {
  db.prepare('UPDATE matches SET kickoff=?, updated_at=? WHERE id=?').run(kickoff, nowIso(), matchId);
}

// Flache Sicht für das Dashboard: ein Datensatz je Tipp inkl. Spiel, Quelle,
// Quoten, Kombi-Infos und Abrechnung.
export function dashboardRows(db) {
  return db.prepare(`
    SELECT s.key AS source, m.home_team AS home, m.away_team AS away,
      m.match_date, m.kickoff, m.home_goals AS fh, m.away_goals AS fa, m.status,
      t.market_code, t.selection, t.odds, t.ref_odds,
      r.slip_type, r.slip_ref, r.slip_odds,
      st.result, st.profit_units AS profit
    FROM tips t
    JOIN sources s ON s.id=t.source_id
    JOIN raw_tips r ON r.id=t.raw_tip_id
    LEFT JOIN matches m ON m.id=t.match_id
    LEFT JOIN settlements st ON st.tip_id=t.id`).all();
}
