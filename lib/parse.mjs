// Kleine Parsing-Helfer für die HTML-Adapter (keine externen Libs).
import { stripTags } from './fetch.mjs';
import { wallToUtcIso } from './time.mjs';

// Die UK-Tipster-Seiten (footballtips, freetips, betclever …) geben Anstoßzeiten
// in UK-Zeit an. Diese TZ wird beim Bauen der ISO-Kickoffs angenommen.
const UK_TZ = 'Europe/London';

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

// Nächstes Datum (heute inkl.) für einen Wochentagsnamen, z. B. "Sunday" -> YYYY-MM-DD
const WD = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
export function dateForWeekday(name, from = new Date()) {
  const target = WD[String(name || '').toLowerCase()];
  if (target == null) return null;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  // footballtips zeigt max. 3 Tage im Voraus; offset > 3 bedeutet vergangener Wochentag.
  let offset = (target - d.getUTCDay() + 7) % 7;
  if (offset > 3) offset -= 7;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// "19 Jun 23:00" -> { date:'2026-06-19', kickoff:'2026-06-19T22:00:00.000Z' }
// Zeit ist UK-Zeit -> kickoff wird nach UTC umgerechnet (DST-korrekt).
// Jahr wird inferiert (liegt der Tag in der Vergangenheit -> nächstes Jahr).
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function parseDayMonth(str, from = new Date()) {
  const m = String(str || '').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*(?:[, ]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const day = Number(m[1]), mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return null;
  let year = from.getUTCFullYear();
  if (mon < from.getUTCMonth() || (mon === from.getUTCMonth() && day < from.getUTCDate() - 1)) year++;
  const date = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const kickoff = m[3] != null ? wallToUtcIso(date, `${m[3].padStart(2, '0')}:${m[4]}`, UK_TZ) : null;
  return { date, kickoff };
}

// "8:00 pm" -> UTC-ISO (Zeit ist UK-Zeit, wird DST-korrekt nach UTC umgerechnet)
export function timeToIso(date, t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*([ap])m/i);
  if (!date || !m) return null;
  let h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12;
  return wallToUtcIso(date, `${String(h).padStart(2, '0')}:${m[2]}`, UK_TZ);
}
