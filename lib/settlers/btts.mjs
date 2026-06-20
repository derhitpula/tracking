// Settler: Beide Teams treffen (Both Teams To Score).  BTTS_YES / BTTS_NO

export const labels = {
  BTTS_YES: 'Beide treffen (BTTS)', BTTS_NO: 'Kein beide-treffen (BTTS No)',
};

export function match(t) {
  // Alleinstehend "yes"/"no" = BTTS (freetips u. ä. geben Markt-Kontext separat aus)
  if (/^yes$/i.test(t)) return 'BTTS_YES';
  if (/^no$/i.test(t)) return 'BTTS_NO';
  const isBtts = /\bbtts\b|both teams (to|will) score|beide.*(treffen|tore)|\bgg\b/.test(t);
  if (!isBtts && !/\bng\b/.test(t)) return null;
  if (/\bno\b|\bng\b|\bkein|\bnicht\b/.test(t)) return 'BTTS_NO';
  return 'BTTS_YES';
}

export function settle(code, ft) {
  if (!ft) return null;
  const both = ft[0] > 0 && ft[1] > 0;
  if (code === 'BTTS_YES') return both ? 'won' : 'lost';
  if (code === 'BTTS_NO') return both ? 'lost' : 'won';
  return null;
}
