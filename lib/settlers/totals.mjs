// Settler: Über/Unter Gesamttore (Totals).  OVER_2_5 / UNDER_1_5 …
// Jeder Settler exportiert match() (Freitext -> Code) und settle() (Code -> Ergebnis).

export const labels = {
  OVER_0_5: 'Über 0.5 Tore', OVER_1_5: 'Über 1.5 Tore', OVER_2_5: 'Über 2.5 Tore',
  OVER_3_5: 'Über 3.5 Tore', OVER_4_5: 'Über 4.5 Tore',
  UNDER_0_5: 'Unter 0.5 Tore', UNDER_1_5: 'Unter 1.5 Tore', UNDER_2_5: 'Unter 2.5 Tore',
  UNDER_3_5: 'Unter 3.5 Tore', UNDER_4_5: 'Unter 4.5 Tore',
};

// Freitext -> Code (oder null). home/away ungenutzt (für Signatur-Einheitlichkeit).
export function match(t) {
  // "over 2.5" / "o2.5" / "über 2,5" / "o25"
  let m = t.match(/\b(over|o|über|ueber)\s*([0-5])[.,]?5\b/);
  if (m) return `OVER_${m[2]}_5`;
  m = t.match(/\b(under|u|unter)\s*([0-5])[.,]?5\b/);
  if (m) return `UNDER_${m[2]}_5`;
  return null;
}

// Code gegen Endstand ft=[heim,auswärts] -> 'won' | 'lost' | null
export function settle(code, ft) {
  const m = code.match(/^(OVER|UNDER)_([0-5])_5$/);
  if (!m || !ft) return null;
  const line = Number(m[2]) + 0.5;
  const total = ft[0] + ft[1];
  if (m[1] === 'OVER') return total > line ? 'won' : 'lost';
  return total < line ? 'won' : 'lost';
}
