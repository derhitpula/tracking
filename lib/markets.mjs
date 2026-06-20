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
import * as combo from './settlers/combo.mjs';

const SETTLERS = [result1x2, btts, totals];

export const TIP_LABELS = Object.assign({}, ...SETTLERS.map((s) => s.labels), combo.labels);
export const marketLabel = (code) => TIP_LABELS[code] || code;

// Strukturierte Codes mancher Adapter (soccervista: 1/X/2; betmines: O25/GG/…)
// direkt auf kanonische Codes abbilden – zuverlässiger als Freitext-Parsing.
const LEGACY = {
  1: 'HOME_WIN', X: 'DRAW', 2: 'AWAY_WIN', '1X': 'DC_1X', 12: 'DC_12', X2: 'DC_X2',
  GG: 'BTTS_YES', NG: 'BTTS_NO',
  O05: 'OVER_0_5', O15: 'OVER_1_5', O25: 'OVER_2_5', O35: 'OVER_3_5', O45: 'OVER_4_5',
  U05: 'UNDER_0_5', U15: 'UNDER_1_5', U25: 'UNDER_2_5', U35: 'UNDER_3_5', U45: 'UNDER_4_5',
};
export const fromLegacy = (c) => LEGACY[c] || null;

// Kombi-Tipp (mehrere Bedingungen verknüpft) -> nicht automatisch auswertbar.
function isCombo(t) {
  return /(\band\b|\+|&|,)/.test(t) &&
    /(over|under|btts|win|draw|goal)/.test(t.replace(/^[^&+,]*/, ''));
}

// Freitext -> kanonischer Code. Gibt null zurück, wenn nicht auto-auswertbar
// (unbekannter Kombi-Markt, exotische Wette) – der Tipp wird trotzdem gespeichert.
export function normalizeMarket(text, home = '', away = '') {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  // Kombi zuerst prüfen, bevor isCombo() blockiert.
  const comboCode = combo.match(t, String(home), String(away));
  if (comboCode) return comboCode;
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
  const comboResult = combo.settle(code, ft);
  if (comboResult) return comboResult;
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
