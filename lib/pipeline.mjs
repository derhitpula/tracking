// Pipeline: orchestriert den Datenfluss über den Daten-Layer (repo.mjs).
//
//   collect  Scraper -> raw_tips -> match-mapping -> tips
//   enrich   matches gegen Ergebnis-API anreichern (Anstoß, Status, Endstand)
//   settle   fertige Spiele -> Tipps auswerten -> settlements
//   fillOdds einheitliche Referenzquoten je Tipp
//   prune    Lebenszyklus: veraltete/nicht auswertbare Tipps entfernen
//   daily    alles in sinnvoller Reihenfolge
import { getOrCreateSource, getOrCreateTipster, nowIso, dayOf } from './db.mjs';
import * as repo from './repo.mjs';
import { normalizeMarket, settleTip, profitUnits } from './markets.mjs';
import { lookupMatch } from './results.mjs';
import { findApiFixture } from './results.mjs';
import { referenceOdds, referenceOddsFallback } from './odds.mjs';
import { fetchHtml, sleep } from './fetch.mjs';
import { today } from './parse.mjs';
import { ADAPTERS } from '../adapters/index.mjs';

const log = (s) => console.log(s);

// --- collect ----------------------------------------------------------------
// Liefert { [sourceId]: Set(rawTipId) } der in diesem Lauf gesehenen Tipps (für prune).
export async function collect(db, filter) {
  const list = filter ? ADAPTERS.filter((a) => a.id === filter) : ADAPTERS;
  if (!list.length) { log(`Unbekannte Quelle: ${filter}`); return {}; }
  const seen = {};
  for (const a of list) {
    const sid = getOrCreateSource(db, a.id, a.name, a.url);
    const tid = getOrCreateTipster(db, sid, 'default');
    seen[sid] ??= new Set();
    let tips = [];
    try {
      const html = a.fetch ? await a.fetch() : await fetchHtml(a.url);
      tips = (await a.parse(html)) || [];
    } catch (e) { log(`  ✗ ${a.id.padEnd(20)} ${e.message}`); continue; }

    let n = 0;
    for (const t of tips) {
      const md = t.match_date || dayOf(t.kickoff) || today();
      const { id: rawId } = repo.upsertRawTip(db, sid, tid, { ...t, match_date: md });
      seen[sid].add(rawId);
      const matchId = (t.home && t.away)
        ? repo.findOrCreateMatch(db, t.home, t.away, md, { kickoff: t.kickoff, league: t.league })
        : null;
      const code = t.market ?? normalizeMarket(t.market_raw, t.home, t.away);
      repo.upsertTip(db, { rawTipId: rawId, sourceId: sid, tipsterId: tid, matchId,
        marketCode: code, selection: t.market_raw, odds: t.odds });
      n++;
    }
    log(`  • ${a.id.padEnd(20)} ${n} Tipp(s)`);
    await sleep(600);
  }
  return seen;
}

// --- enrich: matches gegen API anreichern (ein Lookup je Spiel) -------------
export async function enrich(db) {
  const matches = repo.matchesNeedingResult(db);
  if (!matches.length) { log('Keine Spiele zum Anreichern.'); return; }
  log(`Reichere ${matches.length} Spiel(e) an …`);
  let done = 0, fin = 0;
  for (const m of matches) {
    let info; try { info = await lookupMatch(m.home_team, m.away_team, m.match_date); } catch { info = null; }
    if (!info) continue;
    repo.updateMatchResult(db, m.id, info);
    done++; if (info.status === 'finished') fin++;
    await sleep(200);
  }
  log(`  ${done} aktualisiert, davon ${fin} beendet.`);
}

// --- settle: fertige Spiele auswerten ---------------------------------------
export function settle(db) {
  const tips = repo.tipsNeedingSettle(db);
  if (!tips.length) { log('Keine auswertbaren, fertigen Tipps.'); return; }
  let won = 0, lost = 0;
  for (const t of tips) {
    const ft = [t.fh, t.fa];
    const ht = t.hh != null ? [t.hh, t.ha] : null;
    const result = settleTip(t.market_code, ft, ht);
    if (!result) continue;
    repo.recordSettlement(db, t.id, result, profitUnits(result, t.odds), 'api');
    if (result === 'won') won++; else if (result === 'lost') lost++;
  }
  log(`  ${won + lost} abgerechnet (${won} gewonnen, ${lost} verloren).`);
}

// --- fillOdds: Referenzquoten je Tipp ---------------------------------------
export async function fillOdds(db) {
  const tips = repo.tipsNeedingRefOdds(db);
  if (!tips.length) { log('Keine Tipps ohne Referenzquote.'); return; }
  log(`Hole Referenzquoten für ${tips.length} Tipp(s) …`);
  const fxCache = new Map();
  let done = 0;
  for (const t of tips) {
    const ck = `${t.match_date}|${t.home}|${t.away}`;
    let fx = fxCache.get(ck);
    if (fx === undefined) { fx = await findApiFixture(t.home, t.away, t.match_date); fxCache.set(ck, fx); }
    let ro = null;
    if (fx) { try { ro = await referenceOdds(fx.id, t.market_code, fx.swapped); } catch {} }
    if (ro == null) { try { ro = await referenceOddsFallback(t.home, t.away, t.match_date, t.market_code); } catch {} }
    if (ro != null) { repo.setRefOdds(db, t.id, ro, fx?.id ?? null); done++; }
  }
  log(`  ${done} Referenzquoten gesetzt.`);
}

// --- prune: Lebenszyklus (vorsichtig) ---------------------------------------
// 1) Zukunfts-Waisen: pending Tipps, deren Spiel noch nicht angestoßen ist und
//    die beim letzten erfolgreichen collect der Quelle nicht mehr geliefert wurden.
// 2) Nicht auswertbare Altlasten: market_code NULL und Spiel bereits vorbei.
export function prune(db, seen = {}) {
  const now = nowIso();
  let removed = 0;
  const del = db.prepare('DELETE FROM raw_tips WHERE id=?');

  for (const [sid, ids] of Object.entries(seen)) {
    if (!ids.size) continue; // Quelle lieferte nichts -> kein Kahlschlag
    const rows = db.prepare(`
      SELECT r.id FROM raw_tips r
      JOIN tips t ON t.raw_tip_id=r.id
      JOIN matches m ON m.id=t.match_id
      LEFT JOIN settlements s ON s.tip_id=t.id
      WHERE r.source_id=? AND s.tip_id IS NULL AND m.kickoff IS NOT NULL AND m.kickoff > ?`)
      .all(Number(sid), now);
    for (const r of rows) if (!ids.has(r.id)) { del.run(r.id); removed++; }
  }

  const dead = db.prepare(`
    SELECT r.id FROM raw_tips r
    JOIN tips t ON t.raw_tip_id=r.id
    JOIN matches m ON m.id=t.match_id
    WHERE t.market_code IS NULL AND m.kickoff IS NOT NULL AND m.kickoff < ?`).all(now);
  for (const d of dead) { del.run(d.id); removed++; }

  log(`  ${removed} veraltete/nicht auswertbare Tipps entfernt.`);
  return removed;
}

// --- daily: vollständiger Tagesablauf ---------------------------------------
export async function daily(db, filter) {
  log('▶ collect');  const seen = await collect(db, filter);
  log('▶ prune');    prune(db, seen);
  log('▶ enrich');   await enrich(db);
  log('▶ fillOdds'); await fillOdds(db);
  log('▶ settle');   settle(db);
  log('✓ daily fertig');
}
