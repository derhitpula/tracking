// Gemeinsame Auswertungs-Logik für Report (CLI) und Dashboard.
// Kombi-bewusst: Tipps mit slip_ref (z. B. BetMines Daily Double/Risk) werden
// als EINE Kombi-Wette gewertet (gewinnt nur, wenn alle Legs treffen; Quote =
// Kombiquote). Tipps ohne slip_ref sind Einzelwetten (1 Einheit je Tipp).
import { tipLabel } from './markets.mjs';

const SETTLED = (r) => r === 'won' || r === 'lost' || r === 'void';

// Rohzeilen -> Wett-Einheiten (Kombis + Einzel)
export function toUnits(rows) {
  const slips = new Map();
  const units = [];
  for (const t of rows) {
    const res = t.result || 'pending';
    if (t.slip_ref) {
      if (!slips.has(t.slip_ref)) {
        slips.set(t.slip_ref, { kind: 'combo', source: t.source, slip_ref: t.slip_ref,
          slip_type: t.slip_type || 'acca', odds: t.slip_odds, match_date: t.match_date, legs: [] });
      }
      slips.get(t.slip_ref).legs.push(t);
    } else {
      units.push({ kind: 'single', source: t.source, odds: t.odds, market: t.market,
        match_date: t.match_date, result: res, legs: [t] });
    }
  }
  for (const s of slips.values()) {
    const r = s.legs.map((l) => l.result || 'pending');
    if (r.some((x) => !SETTLED(x))) s.result = 'pending';            // noch nicht alle Legs fertig
    else if (r.every((x) => x === 'won' || x === 'void')) s.result = 'won';
    else s.result = 'lost';
    units.push(s);
  }
  return units;
}

const blank = () => ({ won: 0, lost: 0, void: 0, pending: 0, stake: 0, ret: 0, noOdds: 0 });
function add(o, u) {
  const r = u.result;
  o[r] = (o[r] ?? 0) + 1;
  // ROI nur über Wetten mit bekannter Quote (sonst nicht berechenbar).
  if (SETTLED(r)) {
    if (u.odds) { o.stake++; o.ret += r === 'won' ? u.odds : r === 'void' ? 1 : 0; }
    else o.noOdds++;
  }
}

// Aggregation über Einheiten: gesamt + je Quelle
export function aggregate(units) {
  const overall = blank(), bySource = new Map();
  for (const u of units) {
    add(overall, u);
    if (!bySource.has(u.source)) bySource.set(u.source, blank());
    add(bySource.get(u.source), u);
  }
  return { overall, bySource };
}

// Markt-Trefferquote auf Selektions-Ebene (jedes Leg einzeln, rein informativ)
export function marketStats(rows) {
  const byMarket = new Map();
  for (const t of rows) {
    if (!t.market) continue;
    const k = tipLabel(t.market);
    if (!byMarket.has(k)) byMarket.set(k, blank());
    add(byMarket.get(k), { result: t.result || 'pending', odds: t.odds });
  }
  return byMarket;
}

export const SETTLED_FN = SETTLED;
