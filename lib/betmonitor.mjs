// Betmonitor.com – Quoten-Fallback für Nischen-Ligen (kein Cloudflare, reines HTML).
// Scrapt /odds-comparison/football/today einmal pro Tag, cached die Ergebnisse.
// Gibt die durchschnittlichen Marktquoten zurück (Best-Odds-Anzeige auf der Listenseite).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { UA } from './fetch.mjs';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'results_cache');
const BASE_URL = 'https://www.betmonitor.com/odds-comparison/football/today';

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Fuzzy-Wortvergleich: exakt=1.0, enthält=0.8, langer Präfix=0.7, sonst 0
function wordMatch(w1, w2) {
  if (w1 === w2) return 1.0;
  if (w1.length < 4 || w2.length < 4) return 0;
  if (w2.includes(w1) || w1.includes(w2)) return 0.8;
  let common = 0;
  for (let i = 0; i < Math.min(w1.length, w2.length); i++) {
    if (w1[i] === w2[i]) common++; else break;
  }
  return common / Math.max(w1.length, w2.length) >= 0.75 ? 0.7 : 0;
}

function simScore(a, b) {
  const A = clean(a).split(' ').filter(Boolean);
  const B = clean(b).split(' ').filter(Boolean);
  if (!A.length || !B.length) return 0;
  const score = A.reduce((sum, aw) => sum + Math.max(0, ...B.map((bw) => wordMatch(aw, bw))), 0);
  return score / Math.max(A.length, B.length);
}
// Durchschnitt beider Seiten — robuster bei abgekürzten Teamnamen (z.B. "L.P." = "La Plata")
function pairScore(h1, a1, h2, a2) {
  return (simScore(h1, h2) + simScore(a1, a2)) / 2;
}

function parseEvents(html) {
  const events = [];
  const blocks = html.split('<div class="league-event-new">').slice(1);
  for (const block of blocks) {
    // Teams aus .teams Link extrahieren: "Heim - Gast"
    const tm = block.match(/<div class="teams"><a[^>]+>([^<]+)<\/a>/);
    if (!tm) continue;
    const raw = tm[1].trim();
    const sep = raw.includes(' — ') ? ' — ' : ' - ';
    const idx = raw.lastIndexOf(sep);
    if (idx === -1) continue;
    const home = raw.slice(0, idx).trim();
    const away = raw.slice(idx + sep.length).trim();

    // Unix-Timestamp → Datum
    const tsM = block.match(/data-timestamp="(\d+)"/);
    const date = tsM ? new Date(parseInt(tsM[1]) * 1000).toISOString().slice(0, 10) : null;

    // 1X2 Quoten: von erstem .odds-Start bis zum zweiten .odds-Start
    const odds = { '1': null, X: null, '2': null };
    const o1 = block.indexOf('<div class="odds">');
    if (o1 !== -1) {
      const o2 = block.indexOf('<div class="odds">', o1 + 18);
      const oddsSection = o2 !== -1 ? block.slice(o1, o2) : block.slice(o1, o1 + 600);
      for (const [, lbl, val] of oddsSection.matchAll(/>([1X2]) <span class="odd-decimal[^"]*">(\d+\.\d+)</g)) {
        odds[lbl] = parseFloat(val);
      }
    }

    if (home && away) events.push({ home, away, date, odds });
  }
  return events;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

async function fetchToday() {
  const date = todayIso();
  const file = join(CACHE, `betmonitor_${date}.json`);
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch {} }

  let html = null;
  // curl (zuverlässiger gegen TLS-Filter)
  try {
    const txt = execFileSync('curl', ['-s', '-L', '-A', UA, '-H', 'Accept: text/html', '--max-time', '30', BASE_URL],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (txt && txt.length > 1000) html = txt;
  } catch { /* kein curl im Container – weiter mit native fetch */ }

  // Fallback: native fetch (funktioniert in Docker ohne curl)
  if (!html) {
    try {
      const res = await globalThis.fetch(BASE_URL, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
      if (res.ok) { const t = await res.text(); if (t.length > 1000) html = t; }
    } catch {}
  }

  if (!html) return [];
  const events = parseEvents(html);
  if (events.length) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(events));
  }
  return events;
}

const FLIP = { '1': '2', '2': '1' };

export async function betmonitorOdds(home, away, date, code) {
  if (!['1', 'X', '2'].includes(code)) return null;
  // Nur für heutige Spiele (betmonitor zeigt nur /today)
  if (date && Math.abs(new Date(date) - new Date(todayIso())) > 2 * 86400 * 1000) return null;
  const events = await fetchToday();
  let best = null, bestScore = 0;
  for (const ev of events) {
    // Richtung 1: home=home, away=away
    const s = pairScore(home, away, ev.home, ev.away);
    // Richtung 2: vertauscht (manchmal Heimauswärts-Reihenfolge anders)
    const s2 = pairScore(home, away, ev.away, ev.home);
    const score = Math.max(s, s2);
    if (score > bestScore) { bestScore = score; best = { ev, swapped: s2 > s }; }
  }
  if (!best || bestScore < 0.4) return null;
  const { ev, swapped } = best;
  const effectiveCode = swapped ? (FLIP[code] ?? code) : code;
  return ev.odds[effectiveCode] ?? null;
}
