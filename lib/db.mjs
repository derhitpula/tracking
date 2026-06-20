// Relationales Schema des Tipp-Trackers (SQLite, node:sqlite).
// -----------------------------------------------------------------------------
// Datenfluss:  Scraper -> raw_tips -> Match-Mapping -> tips -> settlements
//
//   sources      Tipp-Quellen (eine Seite/API)
//   tipsters     einzelne Tipster je Quelle (oft genau einer: die Seite selbst)
//   matches      Spiele – zentral, einmal je Begegnung; Stammdaten + Endstand
//   raw_tips     roh gescrapte Tipps (Audit-Layer, unverändert wie geliefert)
//   tips         normalisierte, einem match zugeordnete Tipps (market_code)
//   settlements  Abrechnung eines tips gegen den Endstand (Wahrheit fürs ROI)
//
// Ein tip gilt als "pending", solange kein settlement existiert.
// SQLite zum Start; das Schema ist bewusst Postgres-nah gehalten.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
export const DATA_DIR = join(ROOT, 'data');
export const DB_PATH = join(DATA_DIR, 'tips.db');

export const nowIso = () => new Date().toISOString();
export const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);

export function openDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT NOT NULL UNIQUE,        -- Adapter-ID ('betmines')
      name        TEXT,
      url         TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tipsters (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      UNIQUE(source_id, name)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      api_match_id  INTEGER,                   -- Fixture-ID der Ergebnis-API (nullable)
      provider      TEXT,                      -- 'apifootball' | 'sportsdb' | 'manual'
      league        TEXT,
      country       TEXT,
      home_team     TEXT NOT NULL,
      away_team     TEXT NOT NULL,
      match_date    TEXT NOT NULL,             -- YYYY-MM-DD (UTC-Tag des Anstoßes)
      kickoff       TEXT,                      -- UTC-ISO
      status        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|live|finished|unknown
      home_goals    INTEGER,
      away_goals    INTEGER,
      ht_home       INTEGER,
      ht_away       INTEGER,
      updated_at    TEXT NOT NULL,
      UNIQUE(home_team, away_team, match_date)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_api ON matches(api_match_id) WHERE api_match_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS raw_tips (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      tipster_id    INTEGER REFERENCES tipsters(id) ON DELETE SET NULL,
      home_text     TEXT,
      away_text     TEXT,
      market_text   TEXT,                      -- Originaltipp ("Over 2.5 Goals")
      odds          REAL,                      -- Eigenquote der Quelle
      match_date    TEXT,                      -- wie geliefert/abgeleitet
      kickoff       TEXT,
      league        TEXT,
      slip_type     TEXT NOT NULL DEFAULT 'single', -- single|double|acca|...
      slip_ref      TEXT,                      -- gruppiert Legs einer Kombi
      slip_odds     REAL,
      ext_id        TEXT,
      source_url    TEXT,
      first_seen    TEXT NOT NULL,
      last_seen     TEXT NOT NULL,
      UNIQUE(source_id, match_date, home_text, away_text, market_text)
    );

    CREATE TABLE IF NOT EXISTS tips (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_tip_id    INTEGER NOT NULL UNIQUE REFERENCES raw_tips(id) ON DELETE CASCADE,
      source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      tipster_id    INTEGER REFERENCES tipsters(id) ON DELETE SET NULL,
      match_id      INTEGER REFERENCES matches(id) ON DELETE SET NULL,
      market_code   TEXT,                      -- kanonisch ('OVER_2_5'); NULL = nicht auswertbar
      selection     TEXT,                      -- lesbarer Tipp
      odds          REAL,
      ref_odds      REAL,                      -- einheitliche Referenzquote (Markt)
      ref_fixture   INTEGER,                   -- Fixture-ID der Referenzquote
      closing_odds  REAL,                      -- Schlussquote (für CLV)
      stake_units   REAL NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tips_match ON tips(match_id);
    CREATE INDEX IF NOT EXISTS idx_tips_source ON tips(source_id);

    CREATE TABLE IF NOT EXISTS settlements (
      tip_id        INTEGER PRIMARY KEY REFERENCES tips(id) ON DELETE CASCADE,
      result        TEXT NOT NULL,             -- won|lost|void
      profit_units  REAL NOT NULL,             -- bei stake 1u: won=odds-1, lost=-1, void=0
      result_src    TEXT,                      -- woher der Endstand kam
      settled_at    TEXT NOT NULL
    );
  `);
  return db;
}

// --- Stammdaten-Helfer -------------------------------------------------------

export function getOrCreateSource(db, key, name, url) {
  const found = db.prepare('SELECT id FROM sources WHERE key=?').get(key);
  if (found) {
    db.prepare('UPDATE sources SET name=COALESCE(?,name), url=COALESCE(?,url) WHERE id=?')
      .run(name ?? null, url ?? null, found.id);
    return found.id;
  }
  return db.prepare('INSERT INTO sources (key,name,url,active,created_at) VALUES (?,?,?,1,?)')
    .run(key, name ?? null, url ?? null, nowIso()).lastInsertRowid;
}

export function getOrCreateTipster(db, sourceId, name) {
  const nm = name || 'default';
  const found = db.prepare('SELECT id FROM tipsters WHERE source_id=? AND name=?').get(sourceId, nm);
  if (found) return found.id;
  return db.prepare('INSERT INTO tipsters (source_id,name,created_at) VALUES (?,?,?)')
    .run(sourceId, nm, nowIso()).lastInsertRowid;
}
