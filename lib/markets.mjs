// Markt-Normalisierung + Auswertung gegen einen Endstand.
// Wandelt die unterschiedlichen Tipp-Schreibweisen der Seiten in einheitliche
// Codes um und wertet sie gegen das Resultat aus.
// -----------------------------------------------------------------------------

// Lesbare Labels je Code
export const TIP_LABELS = {
  '1': 'Heimsieg (1)', X: 'Unentschieden (X)', '2': 'Auswärtssieg (2)',
  '1X': 'Heim oder X (1X)', '12': 'Heim oder Ausw. (12)', X2: 'X oder Ausw. (X2)',
  O05: 'Über 0.5 Tore', O15: 'Über 1.5 Tore', O25: 'Über 2.5 Tore',
  O35: 'Über 3.5 Tore', O45: 'Über 4.5 Tore',
  U05: 'Unter 0.5 Tore', U15: 'Unter 1.5 Tore', U25: 'Unter 2.5 Tore',
  U35: 'Unter 3.5 Tore', U45: 'Unter 4.5 Tore',
  GG: 'Beide treffen (BTTS)', NG: 'Kein beide-treffen (BTTS No)',
};
export const tipLabel = (c) => TIP_LABELS[c] || c;

// Freitext -> Code. Gibt { code, kind } zurück; code=null wenn nicht
// automatisch auswertbar (z. B. Kombi-Markt, exotische Wette).
// home/away helfen, "Team X to win" auf 1/2 abzubilden.
// gängige Kürzel/Aliase -> kanonischer (Teil-)Name für das Team-Matching
const ALIAS = { usa: 'united states', uae: 'united arab emirates', us: 'united states',
  korea: 'korea republic', 'south korea': 'korea republic', ksa: 'saudi arabia' };
const expand = (s) => ALIAS[s] || s;

export function normalizeMarket(text, home = '', away = '') {
  if (!text) return { code: null, raw: text };
  const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const raw = String(text).trim();
  const H = home.toLowerCase(), A = away.toLowerCase();

  // Kombi-Tipps (mehrere Bedingungen) -> nicht auto-auswertbar
  if (/(\band\b|\+|&|,).*(over|under|btts|win|goal)/.test(t) &&
      /(over|under|btts|win|draw)/.test(t.replace(/^[^&+,]*/, ''))) {
    return { code: null, raw };
  }

  // Deutsche Märkte (footballpredictions.net)
  let g;
  if ((g = t.match(/über\s*([0-5])[.,]5/))) return { code: 'O' + g[1] + '5', raw };
  if ((g = t.match(/unter\s*([0-5])[.,]5/))) return { code: 'U' + g[1] + '5', raw };
  if (/beide.*(treffen|tore)|btts/.test(t)) return { code: /\bkein|\bnicht/.test(t) ? 'NG' : 'GG', raw };
  if (/heimsieg/.test(t)) return { code: '1', raw };
  if (/auswärtssieg|auswartssieg/.test(t)) return { code: '2', raw };

  // Über/Unter X.5
  let m = t.match(/\b(over|under|o|u)\s*([0-5])\.5\b/);
  if (m) {
    const n = m[2];
    return { code: (/^o/.test(m[1]) ? 'O' : 'U') + n + '5', raw };
  }
  // Schreibweise "o25"/"u35"
  m = t.match(/\b([ou])([0-5])5\b/);
  if (m) return { code: m[1].toUpperCase() + m[2] + '5', raw };

  // BTTS / Both teams to score / GG-NG
  if (/\b(btts|both teams to score|gg)\b/.test(t)) {
    if (/\bno\b/.test(t) || /\bng\b/.test(t)) return { code: 'NG', raw };
    return { code: 'GG', raw };
  }
  if (/\bbtts? no\b|\bno goal\b|\bng\b/.test(t)) return { code: 'NG', raw };

  // Doppelte Chance
  if (/\b(1x|home or draw|draw or home)\b/.test(t)) return { code: '1X', raw };
  if (/\b(x2|away or draw|draw or away)\b/.test(t)) return { code: 'X2', raw };
  if (/\b(12|home or away)\b/.test(t)) return { code: '12', raw };

  // Reines 1X2 / Draw
  if (/\b(draw|x)\b/.test(t) && !/win/.test(t)) return { code: 'X', raw };
  if (/\bhome( win| to win|)\b/.test(t) && !A) { /* fallthrough handled below */ }

  // "Team to win" / "Home win" / "Away win"
  const wantsWin = /\b(win|to win|winner|moneyline|ml)\b|gewinnt|\bsieg\b/.test(t);
  const tWin = t.replace(/\bgewinnt\b/, 'win'); // DE "gewinnt" -> "win"
  if (wantsWin || /\bhome\b|\baway\b/.test(t)) {
    if (/\bhome\b/.test(t)) return { code: '1', raw };
    if (/\baway\b/.test(t)) return { code: '2', raw };
    // Teamphrase vor "win" gegen Heim/Auswärts (mit Alias-Auflösung)
    const phrase = expand(tWin.replace(/\b(to\s+)?(win|winner|moneyline|ml).*$/, '').trim());
    const hit = (name) => name && phrase && (name.includes(phrase) || phrase.includes(name));
    if (H && (t.includes(H) || hit(H))) return { code: '1', raw };
    if (A && (t.includes(A) || hit(A))) return { code: '2', raw };
  }
  // bloßes "1" / "2"
  if (/^1$/.test(t)) return { code: '1', raw };
  if (/^2$/.test(t)) return { code: '2', raw };

  return { code: null, raw }; // unbekannt -> nur gesammelt, nicht auswertbar
}

// Tipp gegen Endstand -> 'won' | 'lost' | 'void' | null (nicht auswertbar)
// ft/ht = [heim, auswärts] oder null
export function evalTip(code, ft, ht) {
  if (!code || !ft) return null;
  const [h, a] = ft;
  let m;
  if ((m = code.match(/^O([0-5])5(HT)?$/))) {
    const sc = m[2] ? ht : ft; if (!sc) return null;
    return sc[0] + sc[1] > Number(m[1]) + 0.5 ? 'won' : 'lost';
  }
  if ((m = code.match(/^U([0-5])5(HT)?$/))) {
    const sc = m[2] ? ht : ft; if (!sc) return null;
    return sc[0] + sc[1] < Number(m[1]) + 0.5 ? 'won' : 'lost';
  }
  switch (code) {
    case 'GG': return h > 0 && a > 0 ? 'won' : 'lost';
    case 'NG': return h > 0 && a > 0 ? 'lost' : 'won';
    case '1': return h > a ? 'won' : 'lost';
    case 'X': return h === a ? 'won' : 'lost';
    case '2': return a > h ? 'won' : 'lost';
    case '1X': return h >= a ? 'won' : 'lost';
    case 'X2': return a >= h ? 'won' : 'lost';
    case '12': return h !== a ? 'won' : 'lost';
    default: return null;
  }
}
