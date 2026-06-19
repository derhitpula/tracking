// Einheitliches SQLite-Schema für alle Quellen.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
export const DATA_DIR = join(ROOT, 'data');
export const DB_PATH = join(DATA_DIR, 'tips.db');

export function openDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tips (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source      TEXT NOT NULL,      -- Adapter-ID (z. B. 'betmines')
      match_date  TEXT,               -- Spieltag YYYY-MM-DD
      kickoff     TEXT,               -- ISO-Zeit falls bekannt
      home        TEXT,
      away        TEXT,
      league      TEXT,
      market_raw  TEXT,               -- Original-Tipp ("Over 2.5 Goals")
      market      TEXT,               -- normalisierter Code (O25, GG, 1, ...)
      odds        REAL,
      slip_type   TEXT,               -- 'single' | 'double' | 'acca' | ...
      slip_ref    TEXT,               -- gruppiert Legs einer Kombi (sonst NULL)
      slip_odds   REAL,               -- Gesamtquote der Kombi
      source_url  TEXT,               -- Link zur Spiel-/Tipp-Seite
      ext_id      TEXT,               -- seiteneigene ID (Dedupe)
      ft_home     INTEGER,
      ft_away     INTEGER,
      ht_home     INTEGER,
      ht_away     INTEGER,
      result      TEXT,               -- won | lost | void | pending | unknown
      result_src  TEXT,               -- woher das Ergebnis kam (matchpage/apifootball/...)
      settled_at  TEXT,
      first_seen  TEXT,
      last_seen   TEXT,
      UNIQUE(source, match_date, home, away, market_raw)
    );
    CREATE INDEX IF NOT EXISTS idx_tips_pending ON tips(result) WHERE result IS NULL OR result='pending';
  `);
  // Migration: Referenzquote (einheitliche Marktquote je Spiel+Markt)
  const cols = new Set(db.prepare('PRAGMA table_info(tips)').all().map((r) => r.name));
  if (!cols.has('ref_odds')) db.exec('ALTER TABLE tips ADD COLUMN ref_odds REAL');
  if (!cols.has('ref_fixture')) db.exec('ALTER TABLE tips ADD COLUMN ref_fixture INTEGER');

  // Migration SoccerVista-Duplikate:
  // SoccerVista liefert dasselbe Spiel oft in mehreren Liga-Blöcken (manchmal
  // verschiedene Teamnamen). Dedup per kickoff (zuverlässigster Identifier).
  // Zeilen ohne kickoff: per (match_date, home, away) deduplizieren.
  // Abgerechnete Ergebnisse bevorzugen, sonst neueste id behalten.
  db.exec(`
    DELETE FROM tips WHERE source='soccervista' AND id NOT IN (
      SELECT CASE
        WHEN MAX(CASE WHEN result IS NOT NULL AND result!='pending' THEN id END) IS NOT NULL
        THEN MAX(CASE WHEN result IS NOT NULL AND result!='pending' THEN id END)
        ELSE MAX(id)
      END
      FROM tips WHERE source='soccervista'
      GROUP BY COALESCE(kickoff, match_date||'|'||COALESCE(home,'')||'|'||COALESCE(away,''))
    )
  `);
  // market_raw auf '1X2' normalisieren (früher stand dort 'Sieg TeamName' o.ä.)
  db.exec(`UPDATE tips SET market_raw='1X2' WHERE source='soccervista' AND market IN ('1','X','2')`);

  return db;
}

export const nowIso = () => new Date().toISOString();
export const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);

// Upsert eines Tipps. Aktualisiert Quoten/Anstoß, lässt Ergebnisse unberührt.
export function upsertTip(db, t) {
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO tips (source,match_date,kickoff,home,away,league,market_raw,market,
      odds,slip_type,slip_ref,slip_odds,source_url,ext_id,first_seen,last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source,match_date,home,away,market_raw) DO UPDATE SET
      kickoff=COALESCE(excluded.kickoff, tips.kickoff), league=excluded.league, market=excluded.market,
      odds=COALESCE(excluded.odds, tips.odds), slip_type=excluded.slip_type,
      slip_ref=excluded.slip_ref, slip_odds=excluded.slip_odds,
      source_url=excluded.source_url, last_seen=excluded.last_seen`);
  const info = stmt.run(t.source, t.match_date, t.kickoff ?? null, t.home ?? null,
    t.away ?? null, t.league ?? null, t.market_raw ?? null, t.market ?? null,
    t.odds ?? null, t.slip_type ?? 'single', t.slip_ref ?? null, t.slip_odds ?? null,
    t.source_url ?? null, t.ext_id ?? null, ts, ts);
  return info.changes;
}
