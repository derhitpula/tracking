// Teamnamen-Normalisierung & Fuzzy-Vergleich.
// Wird fürs Match-Mapping (gleiche Begegnung über verschiedene Quellen hinweg)
// und für die Fixture-Suche in der Ergebnis-API genutzt.

// generische Vereins-Suffixe als Stoppwörter (NICHT united/city -> die
// unterscheiden Teams wie Man United vs Man City)
const STOP = new Set(['fc', 'sc', 'afc', 'cf', 'ac', 'fk', 'sk', 'if', 'bk', 'cd', 'ud', 'club', 'the', 'calcio']);

// Mehrsprachige/abgekürzte Nationen + Vereine auf einen kanonischen Namen bringen
const NAMEALIAS = {
  usa: 'united states', us: 'united states', 'vereinigte staaten': 'united states', 'etats unis': 'united states',
  'korea republic': 'south korea', korea: 'south korea', sudkorea: 'south korea',
  'cote d ivoire': 'ivory coast', elfenbeinkuste: 'ivory coast',
  marokko: 'morocco', schottland: 'scotland', australien: 'australia',
  deutschland: 'germany', spanien: 'spain', 'saudi arabien': 'saudi arabia',
  turkei: 'turkey', turkiye: 'turkey', tschechien: 'czech republic',
  niederlande: 'netherlands', england: 'england',
};

export const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function tokens(name) {
  let c = clean(name); c = NAMEALIAS[c] || c;
  return c.split(' ').filter((w) => w && !STOP.has(w));
}

// Ähnlichkeit zweier Teamnamen in [0,1].
export function nameScore(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  let sub = 0; // Substring-Bonus ("Bohemians" vs "Bohemian")
  for (const x of A) for (const y of B) if (x.length > 3 && (x.includes(y) || y.includes(x))) sub++;
  return (inter + 0.5 * sub) / Math.max(A.size, B.size);
}

// Schwelle, ab der zwei Begegnungen als dieselbe gelten.
export const TEAM_OK = 0.5;

// Passt die Begegnung (home/away) zu einem Spiel g{home,away}? -> {ok, swapped}
export function matchTeams(home, away, g) {
  const direct = Math.min(nameScore(home, g.home), nameScore(away, g.away));
  const swap = Math.min(nameScore(home, g.away), nameScore(away, g.home));
  const score = Math.max(direct, swap);
  return { ok: score >= TEAM_OK, score, swapped: swap > direct };
}
