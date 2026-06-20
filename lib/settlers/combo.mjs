// Settler: Kombi-Märkte – 1X2 + Totals / 1X2 + BTTS
// Beispiele: "Germany Win & Over 2.5" → HOME_WIN_OVER_2_5
//            "Egypt Win & BTTS - Yes"  → HOME_WIN_BTTS_YES
import { match as match1x2, settle as settle1x2 } from './result1x2.mjs';
import { match as matchTotals, settle as settleTotals } from './totals.mjs';
import { match as matchBtts, settle as settleBtts } from './btts.mjs';

export const labels = {
  HOME_WIN_OVER_0_5: 'Heimsieg & Über 0.5',
  HOME_WIN_OVER_1_5: 'Heimsieg & Über 1.5',
  HOME_WIN_OVER_2_5: 'Heimsieg & Über 2.5',
  HOME_WIN_OVER_3_5: 'Heimsieg & Über 3.5',
  HOME_WIN_OVER_4_5: 'Heimsieg & Über 4.5',
  HOME_WIN_BTTS_YES: 'Heimsieg & Beide treffen',
  HOME_WIN_BTTS_NO:  'Heimsieg & Kein BTTS',
  AWAY_WIN_OVER_0_5: 'Auswärtssieg & Über 0.5',
  AWAY_WIN_OVER_1_5: 'Auswärtssieg & Über 1.5',
  AWAY_WIN_OVER_2_5: 'Auswärtssieg & Über 2.5',
  AWAY_WIN_OVER_3_5: 'Auswärtssieg & Über 3.5',
  AWAY_WIN_OVER_4_5: 'Auswärtssieg & Über 4.5',
  AWAY_WIN_BTTS_YES: 'Auswärtssieg & Beide treffen',
  AWAY_WIN_BTTS_NO:  'Auswärtssieg & Kein BTTS',
  DRAW_OVER_1_5: 'Unentschieden & Über 1.5',
  DRAW_OVER_2_5: 'Unentschieden & Über 2.5',
  DRAW_BTTS_YES: 'Unentschieden & Beide treffen',
};

function splitParts(t) {
  return t.split(/\s*(?:&|and|\+)\s*/i).map((s) => s.trim()).filter(Boolean);
}

// Freitext -> Kombi-Code, oder null wenn kein bekanntes Muster.
export function match(t, home = '', away = '') {
  const parts = splitParts(t);
  if (parts.length < 2) return null;

  // Versuche alle Paar-Permutationen (Reihenfolge kann variieren).
  for (let i = 0; i < parts.length; i++) {
    for (let j = 0; j < parts.length; j++) {
      if (i === j) continue;
      const win = match1x2(parts[i], home, away);
      if (!win || !['HOME_WIN', 'AWAY_WIN', 'DRAW'].includes(win)) continue;

      const over = matchTotals(parts[j]);
      if (over) return `${win}_${over}`;

      const btts = matchBtts(parts[j]);
      if (btts) return `${win}_${btts}`;
    }
  }
  return null;
}

// Kombiniertes Ergebnis: beide Bedingungen müssen stimmen.
export function settle(code, ft) {
  if (!ft) return null;
  const m = code.match(/^(HOME_WIN|AWAY_WIN|DRAW)_((?:OVER|UNDER)_\d_5|BTTS_YES|BTTS_NO)$/);
  if (!m) return null;
  const [, part1, part2] = m;

  const r1 = settle1x2(part1, ft);
  const r2 = part2.startsWith('BTTS') ? settleBtts(part2, ft) : settleTotals(part2, ft);
  if (!r1 || !r2) return null;
  if (r1 === 'lost' || r2 === 'lost') return 'lost';
  if (r1 === 'won' && r2 === 'won') return 'won';
  return 'void';
}
