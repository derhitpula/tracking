// Kleine Parsing-Helfer für die HTML-Adapter (keine externen Libs).
import { stripTags } from './fetch.mjs';

// Quote aus Text: fraktional "8/11" -> 1.73, dezimal "1.80" -> 1.80
export function parseOdds(s) {
  if (s == null) return null;
  const str = String(s).trim();
  let m = str.match(/(\d{1,3})\s*\/\s*(\d{1,3})\b/); // fraktional a/b
  if (m && Number(m[2]) !== 0) return +(1 + Number(m[1]) / Number(m[2])).toFixed(2);
  m = str.match(/\b(\d{1,2}\.\d{1,2})\b/);           // dezimal
  if (m) return Number(m[1]);
  return null;
}

// "TeamA vs TeamB" / "TeamA v TeamB" / "TeamA - TeamB" -> {home, away}
export function splitTeams(s) {
  const t = stripTags(s);
  const m = t.match(/^(.*?)\s+(?:vs?\.?|v|—|–|-)\s+(.*)$/i);
  if (!m) return null;
  const clean = (x) => x.replace(/^[⚽\s|]+|[|\s]+$/g, '').trim();
  const home = clean(m[1]), away = clean(m[2]);
  if (!home || !away || home.length > 40 || away.length > 40) return null;
  return { home, away };
}

// alle Vorkommen einer Regex mit Gruppen als Array
export function matchAll(html, re) {
  const out = []; let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(html))) out.push(m);
  return out;
}

// Heutiges Datum YYYY-MM-DD (lokal)
export const today = () => new Date().toISOString().slice(0, 10);
