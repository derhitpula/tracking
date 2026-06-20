// Settler: Spielausgang 1X2 + Doppelte Chance.
// HOME_WIN / DRAW / AWAY_WIN / DC_1X / DC_12 / DC_X2

export const labels = {
  HOME_WIN: 'Heimsieg (1)', DRAW: 'Unentschieden (X)', AWAY_WIN: 'Auswärtssieg (2)',
  DC_1X: 'Heim oder X (1X)', DC_12: 'Heim oder Ausw. (12)', DC_X2: 'X oder Ausw. (X2)',
};

// Kürzel/Aliase -> kanonischer Teamname fürs Matching von "Team X to win".
const ALIAS = { usa: 'united states', us: 'united states', uae: 'united arab emirates',
  korea: 'korea republic', 'south korea': 'korea republic', ksa: 'saudi arabia' };
const expand = (s) => ALIAS[s] || s;

// Freitext -> Code. home/away helfen, "Germany to win" auf HOME/AWAY abzubilden.
export function match(t, home = '', away = '') {
  // Doppelte Chance
  if (/\b(1x|home or draw|draw or home)\b/.test(t)) return 'DC_1X';
  if (/\b(x2|away or draw|draw or away)\b/.test(t)) return 'DC_X2';
  if (/\b(12|home or away|away or home)\b/.test(t)) return 'DC_12';

  // Unentschieden
  if (/\b(draw|unentschieden|remis)\b/.test(t) && !/win/.test(t)) return 'DRAW';
  if (/^x$/.test(t)) return 'DRAW';

  const H = home.toLowerCase(), A = away.toLowerCase();
  const wantsWin = /\b(win|to win|winner|moneyline|ml|sieg)\b|gewinnt|heimsieg|auswärtssieg|auswartssieg/.test(t);
  if (!wantsWin && !/\bhome\b|\baway\b/.test(t) && !/^[12]$/.test(t)) return null;

  if (/heimsieg|\bhome\b/.test(t)) return 'HOME_WIN';
  if (/auswärtssieg|auswartssieg|\baway\b/.test(t)) return 'AWAY_WIN';
  if (/^1$/.test(t)) return 'HOME_WIN';
  if (/^2$/.test(t)) return 'AWAY_WIN';

  // Teamphrase vor "win"/"gewinnt" gegen Heim/Auswärts (mit Alias-Auflösung)
  const phrase = expand(t.replace(/\bgewinnt\b/, 'win')
    .replace(/\b(to\s+)?(win|winner|moneyline|ml).*$/, '').trim());
  const hit = (name) => name && phrase && (name.includes(phrase) || phrase.includes(name));
  if (H && (t.includes(H) || hit(H))) return 'HOME_WIN';
  if (A && (t.includes(A) || hit(A))) return 'AWAY_WIN';
  return null;
}

export function settle(code, ft) {
  if (!ft) return null;
  const [h, a] = ft;
  switch (code) {
    case 'HOME_WIN': return h > a ? 'won' : 'lost';
    case 'DRAW':     return h === a ? 'won' : 'lost';
    case 'AWAY_WIN': return a > h ? 'won' : 'lost';
    case 'DC_1X':    return h >= a ? 'won' : 'lost';
    case 'DC_X2':    return a >= h ? 'won' : 'lost';
    case 'DC_12':    return h !== a ? 'won' : 'lost';
    default:         return null;
  }
}
