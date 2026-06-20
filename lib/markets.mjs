// Markt-Registry: bündelt die einzelnen Settler (lib/settlers/*) zu einer
// einheitlichen API für Normalisierung und Auswertung.
//
//   normalizeMarket(text, home, away) -> kanonischer Code | null
//   settleTip(code, ft, ht)           -> 'won' | 'lost' | 'void' | null
//   marketLabel(code)                 -> lesbares Label
//
// Neue Märkte = neues Modul in lib/settlers/ + hier in SETTLERS eintragen.
import * as result1x2 from './settlers/result1x2.mjs';
import * as btts from './settlers/btts.mjs';
import * as totals from './settlers/totals.mjs';

const SETTLERS = [result1x2, btts, totals];

export const TIP_LABELS = Object.assign({}, ...SETTLERS.map((s) => s.labels));
export const marketLabel = (code) => TIP_LABELS[code] || code;

// Kombi-Tipp (mehrere Bedingungen verknüpft) -> nicht automatisch auswertbar.
function isCombo(t) {
  return /(\band\b|\+|&|,)/.test(t) &&
    /(over|under|btts|win|draw|goal)/.test(t.replace(/^[^&+,]*/, ''));
}

// Freitext -> kanonischer Code. Gibt null zurück, wenn nicht auto-auswertbar
// (Kombi-Markt, exotische Wette) – der Tipp wird trotzdem gespeichert.
export function normalizeMarket(text, home = '', away = '') {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  if (isCombo(t)) return null;
  for (const s of SETTLERS) {
    const code = s.match(t, String(home), String(away));
    if (code) return code;
  }
  return null;
}

// Tipp gegen Endstand auswerten. ft/ht = [heim, auswärts] (UTC-Endstand / Halbzeit).
export function settleTip(code, ft, ht) {
  if (!code || !ft) return null;
  for (const s of SETTLERS) {
    const r = s.settle(code, ft, ht);
    if (r) return r;
  }
  return null;
}

// Gewinn in Einheiten bei Einsatz 1u: won -> odds-1, lost -> -1, void -> 0.
export function profitUnits(result, odds, stake = 1) {
  if (result === 'won') return odds ? stake * (odds - 1) : 0;
  if (result === 'lost') return -stake;
  return 0; // void / push
}
