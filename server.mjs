// Leichtgewichtiges Web-Dashboard (ohne externe Pakete).
// Zeigt Report, Quellen-/Markt-Vergleich und die letzten Tipps.
import { createServer } from 'node:http';
import { openDb } from './lib/db.mjs';
import { tipLabel } from './lib/markets.mjs';
import { toUnits, aggregate, marketStats } from './lib/stats.mjs';

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '–');
const signed = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
const roiOf = (s) => (s.stake ? signed(100 * (s.ret - s.stake) / s.stake) + '%' : '–');
const roiNum = (s) => (s.stake ? 100 * (s.ret - s.stake) / s.stake : null);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// YYYY-MM-DD -> TT.MM.JJJJ (deutsches Datumsformat)
const deDate = (iso) => { const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? '?'); };
// ISO-Kickoff -> HH:MM in UTC+2 (CEST)
const kickoffTime = (iso) => {
  if (!iso) return '';
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  const h = (parseInt(m[1]) + 2) % 24;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

// Stabile Farbe je Quelle (HSL aus Namens-Hash)
function srcColor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 60% 62%)`;
}
const srcBadge = (name) => `<span class="badge src" style="--c:${srcColor(name)}">${esc(name)}</span>`;

// Ergebnis-Pille
function pill(r) {
  const map = { won: ['Gewonnen', 'won'], lost: ['Verloren', 'lost'], void: ['Void', 'void'],
    pending: ['Offen', 'pending'], unknown: ['?', 'unknown'] };
  const [label, cls] = map[r] || map.unknown;
  return `<span class="pill ${cls}">${label}</span>`;
}

// Trefferquoten-Balken (won/lost)
function bar(won, lost) {
  const tot = won + lost;
  if (!tot) return '<div class="bar"><span class="muted">–</span></div>';
  const w = (100 * won / tot).toFixed(0);
  return `<div class="bar"><div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>` +
    `<span class="bar-lbl">${won}/${tot}</span></div>`;
}

function srcRow(name, s) {
  const st = s.won + s.lost;
  const roi = roiNum(s);
  const roiCls = roi == null ? 'muted' : roi > 0 ? 'pos' : roi < 0 ? 'neg' : '';
  return `<tr><td>${srcBadge(name)}</td><td>${bar(s.won, s.lost)}</td>` +
    `<td>${pct(s.won, st)}</td><td class="${roiCls}">${roiOf(s)}</td>` +
    `<td><span class="pill pending sm">${s.pending}</span></td></tr>`;
}

// SoccerVista + SoccerVital laufen als eigene Tracker und werden aus dem
// Haupt-Dashboard ausgeblendet.
const SV_SOURCE = 'soccervista';
const SV2_SOURCE = 'soccervital';

function svHtml() {
  const db = openDb();
  const rows = db.prepare(
    "SELECT * FROM tips WHERE source=? ORDER BY match_date ASC, CASE WHEN kickoff IS NULL THEN 1 ELSE 0 END, kickoff ASC"
  ).all(SV_SOURCE);
  db.close();
  if (!rows.length) return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>SoccerVista Tracker</title></head><body><p>Noch keine Daten. Erst <code>node track.mjs collect soccervista</code> ausführen.</p></body></html>`;

  const settled = rows.filter((r) => r.result && r.result !== 'pending');
  const won = settled.filter((r) => r.result === 'won').length;
  const lost = settled.filter((r) => r.result === 'lost').length;
  const pending = rows.filter((r) => !r.result || r.result === 'pending').length;
  const winRate = settled.length ? (100 * won / settled.length).toFixed(1) : null;

  // Stats nach Markt
  const byMkt = {};
  for (const r of rows) {
    const k = r.market || '?';
    byMkt[k] = byMkt[k] || { won: 0, lost: 0, pending: 0 };
    if (r.result === 'won') byMkt[k].won++;
    else if (r.result === 'lost') byMkt[k].lost++;
    else byMkt[k].pending++;
  }

  const mktRows = Object.entries(byMkt).sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost)).map(([k, s]) => {
    const tot = s.won + s.lost;
    const wr = tot ? (100 * s.won / tot).toFixed(1) + '%' : '—';
    return `<tr><td><b>${esc(tipLabel(k))}</b></td><td>${bar(s.won, s.lost)}</td><td>${wr}</td>` +
      `<td><span class="pill pending sm">${s.pending}</span></td></tr>`;
  }).join('');

  const tipRows = rows.slice(0, 120).map((t) => {
    const r = t.result || 'pending';
    const sc = t.ft_home != null ? `<span class="score">${t.ft_home}–${t.ft_away}</span>` : '';
    const oddCell = t.ref_odds != null
      ? `<b class="odd">${t.ref_odds}</b>`
      : `<span class="muted">—</span>`;
    const kt = kickoffTime(t.kickoff);
    return `<tr><td class="nowrap">${deDate(t.match_date)}${kt ? ` <span class="kt">${kt}</span>` : ''}</td>` +
      `<td class="match">${esc(t.home)} <span class="vs">vs</span> ${esc(t.away)}${sc}</td>` +
      `<td><span class="tip">${esc(tipLabel(t.market) || t.market_raw || '?')}</span></td>` +
      `<td>${oddCell}</td><td>${pill(r)}</td></tr>`;
  }).join('');

  const dates = rows.map((t) => t.match_date).filter(Boolean).sort();

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>SoccerVista Tracker</title><style>
:root{
  --bg:#04140d; --bg2:#061b12; --panel:#082318; --panel2:#0b3122; --line:#13402d;
  --txt:#eafff5; --muted:#79a892; --accent:#ffdf1b; --accent2:#0f5e42;
  --green:#2fe08a; --red:#ff6b6b; --amber:#ffdf1b; --grey:#5f8473;
  color-scheme:dark;
}
*{box-sizing:border-box}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0;
  background:radial-gradient(1200px 600px at 50% -200px,#0d4a33 0,var(--bg) 55%);color:var(--txt);min-height:100vh}
.wrap{max-width:1000px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
h1{font-size:22px;font-weight:800;margin:0;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
h1 .logo{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;
  background:var(--accent2);border:2px solid var(--accent);font-size:13px;box-shadow:0 4px 14px rgba(255,223,27,.3)}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin:30px 0 10px}
.back{font-size:12px;color:var(--muted);text-decoration:none;padding:4px 10px;border:1px solid var(--line);border-radius:6px}
.back:hover{color:var(--txt)}
.sub{color:var(--muted);font-size:12px;text-align:right}
.sub b{color:var(--txt);font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:18px}
.card{position:relative;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
  border-radius:14px;padding:14px 16px;overflow:hidden}
.card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--accent)}
.card.pos::before{background:var(--green)}.card.neg::before{background:var(--red)}
.card .v{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.card .l{color:var(--muted);font-size:11px;margin-top:3px;font-weight:500}
.card.pos .v{color:var(--green)}.card.neg .v{color:var(--red)}
table{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel);
  border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
th{background:var(--bg2);color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
tbody tr{transition:background .12s}
tbody tr:hover{background:var(--panel2)}
.nowrap{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.pos{color:var(--green);font-weight:600}.neg{color:var(--red);font-weight:600}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
.pill.sm{padding:1px 8px;font-weight:600}
.pill.won{background:rgba(57,217,138,.16);box-shadow:inset 0 0 0 1px rgba(57,217,138,.35);color:var(--green)}
.pill.lost{color:var(--red);background:rgba(255,107,107,.16);box-shadow:inset 0 0 0 1px rgba(255,107,107,.32)}
.pill.pending{color:var(--amber);background:rgba(255,193,69,.14);box-shadow:inset 0 0 0 1px rgba(255,193,69,.3)}
.pill.void,.pill.unknown{color:var(--grey);background:rgba(107,118,137,.16);box-shadow:inset 0 0 0 1px rgba(107,118,137,.3)}
.bar{display:flex;align-items:center;gap:8px;min-width:100px}
.bar-track{flex:1;height:6px;background:var(--bg2);border-radius:999px;overflow:hidden;min-width:50px}
.bar-fill{height:100%;background:linear-gradient(90deg,var(--green),#8ef0bf);border-radius:999px}
.bar-lbl{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.match{font-weight:500}.match .vs{color:var(--muted);font-size:11px;padding:0 2px}
.score{margin-left:5px;font-size:11px;color:var(--muted);background:var(--bg2);padding:1px 6px;border-radius:5px;font-weight:600}
.tip{color:#cdd6e6}.odd{font-variant-numeric:tabular-nums;font-weight:700}.kt{color:var(--muted);font-size:11px}
.info{color:var(--muted);font-size:12px;margin-top:8px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
footer{color:var(--muted);margin-top:30px;font-size:11px;line-height:1.6;border-top:1px solid var(--line);padding-top:14px}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<header>
  <h1><span class="logo">⚽</span> SoccerVista Tracker</h1>
  <div class="sub">${deDate(dates[0])} – ${deDate(dates.at(-1))} · <b>${rows.length}</b> Picks<br>
    aktualisiert ${new Date().toLocaleString('de-DE')} &nbsp;<a class="back" href="/">← Hauptdashboard</a></div>
</header>

<div class="cards">
  <div class="card ${won > lost ? 'pos' : ''}"><div class="v">${won}<span class="muted" style="font-size:15px">/${won + lost}</span></div><div class="l">Treffer (abgerechnet)</div></div>
  <div class="card ${winRate !== null && Number(winRate) >= 50 ? 'pos' : winRate !== null ? 'neg' : ''}"><div class="v">${winRate !== null ? winRate + '%' : '—'}</div><div class="l">Trefferquote</div></div>
  <div class="card"><div class="v" style="color:var(--amber)">${pending}</div><div class="l">offen</div></div>
  <div class="card"><div class="v">${settled.length}</div><div class="l">abgerechnet</div></div>
</div>

<div class="info">ℹ Quoten: SoccerVista liefert keine eigenen Quoten. Referenzquoten (Bet365 via API-Football) werden automatisch eingetragen – für viele Nischenligen (Australien, Irland, Belarus …) nicht verfügbar.</div>

<h2>Nach Markt</h2>
<div class="scroll"><table><thead><tr><th>Markt</th><th>Trefferquote</th><th>Quote %</th><th>offen</th></tr></thead><tbody>${mktRows}</tbody></table></div>

<h2>Alle Picks</h2>
<div class="scroll"><table><thead><tr><th>Datum</th><th>Spiel</th><th>Tipp</th><th>Quote (Ref)</th><th>Ergebnis</th></tr></thead><tbody>${tipRows}</tbody></table></div>

<footer>Picks: predictionPoints=10 (max. Konfidenz) aus der SoccerVista-API · Auto-Refresh 5 Min</footer>
</div></body></html>`;
}

function sv2Html() {
  const db = openDb();
  const rows = db.prepare(
    "SELECT * FROM tips WHERE source=? ORDER BY match_date ASC, CASE WHEN kickoff IS NULL THEN 1 ELSE 0 END, kickoff ASC"
  ).all(SV2_SOURCE);
  db.close();
  if (!rows.length) return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>SoccerVital Tracker</title></head><body><p>Noch keine Daten. Erst <code>node track.mjs collect soccervital</code> ausführen.</p></body></html>`;

  const settled = rows.filter((r) => r.result && r.result !== 'pending');
  const won = settled.filter((r) => r.result === 'won').length;
  const lost = settled.filter((r) => r.result === 'lost').length;
  const pending = rows.filter((r) => !r.result || r.result === 'pending').length;
  const winRate = settled.length ? (100 * won / settled.length).toFixed(1) : null;

  const byMkt = {};
  for (const r of rows) {
    const k = r.market || r.market_raw || '?';
    byMkt[k] = byMkt[k] || { won: 0, lost: 0, pending: 0 };
    if (r.result === 'won') byMkt[k].won++;
    else if (r.result === 'lost') byMkt[k].lost++;
    else byMkt[k].pending++;
  }

  const mktRows = Object.entries(byMkt).sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost)).map(([k, s]) => {
    const tot = s.won + s.lost;
    const wr = tot ? (100 * s.won / tot).toFixed(1) + '%' : '—';
    return `<tr><td><b>${esc(tipLabel(k))}</b></td><td>${bar(s.won, s.lost)}</td><td>${wr}</td>` +
      `<td><span class="pill pending sm">${s.pending}</span></td></tr>`;
  }).join('');

  const tipRows = rows.slice(0, 200).map((t) => {
    const r = t.result || 'pending';
    const sc = t.ft_home != null ? `<span class="score">${t.ft_home}–${t.ft_away}</span>` : '';
    const ownOdds = t.odds != null ? t.odds : null;
    const refOdds = t.ref_odds != null ? t.ref_odds : null;
    const oddCell = refOdds != null
      ? `<b class="odd">${refOdds}</b>${ownOdds != null && ownOdds !== refOdds ? ` <span class="muted own">(${ownOdds})</span>` : ''}`
      : (ownOdds != null ? `<span class="odd">${ownOdds}</span>` : '<span class="muted">—</span>');
    const kt = kickoffTime(t.kickoff);
    return `<tr><td class="nowrap">${deDate(t.match_date)}${kt ? ` <span class="kt">${kt}</span>` : ''}</td>` +
      `<td class="match">${esc(t.home)} <span class="vs">vs</span> ${esc(t.away)}${sc}</td>` +
      `<td><span class="tip">${esc(tipLabel(t.market) || t.market_raw || '?')}</span></td>` +
      `<td>${oddCell}</td><td>${pill(r)}</td></tr>`;
  }).join('');

  const dates = rows.map((t) => t.match_date).filter(Boolean).sort();

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>SoccerVital Tracker</title><style>
:root{
  --bg:#04140d; --bg2:#061b12; --panel:#082318; --panel2:#0b3122; --line:#13402d;
  --txt:#eafff5; --muted:#79a892; --accent:#ffdf1b; --accent2:#0f5e42;
  --green:#2fe08a; --red:#ff6b6b; --amber:#ffdf1b; --grey:#5f8473;
  color-scheme:dark;
}
*{box-sizing:border-box}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0;
  background:radial-gradient(1200px 600px at 50% -200px,#0d4a33 0,var(--bg) 55%);color:var(--txt);min-height:100vh}
.wrap{max-width:1000px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
h1{font-size:22px;font-weight:800;margin:0;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
h1 .logo{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;
  background:var(--accent2);border:2px solid var(--accent);font-size:13px;box-shadow:0 4px 14px rgba(255,223,27,.3)}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin:30px 0 10px}
.back{font-size:12px;color:var(--muted);text-decoration:none;padding:4px 10px;border:1px solid var(--line);border-radius:6px}
.back:hover{color:var(--txt)}
.sub{color:var(--muted);font-size:12px;text-align:right}
.sub b{color:var(--txt);font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:18px}
.card{position:relative;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
  border-radius:14px;padding:14px 16px;overflow:hidden}
.card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--accent)}
.card.pos::before{background:var(--green)}.card.neg::before{background:var(--red)}
.card .v{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.card .l{color:var(--muted);font-size:11px;margin-top:3px;font-weight:500}
.card.pos .v{color:var(--green)}.card.neg .v{color:var(--red)}
table{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel);
  border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
th{background:var(--bg2);color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
tbody tr{transition:background .12s}
tbody tr:hover{background:var(--panel2)}
.nowrap{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.pos{color:var(--green);font-weight:600}.neg{color:var(--red);font-weight:600}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
.pill.sm{padding:1px 8px;font-weight:600}
.pill.won{background:rgba(57,217,138,.16);box-shadow:inset 0 0 0 1px rgba(57,217,138,.35);color:var(--green)}
.pill.lost{color:var(--red);background:rgba(255,107,107,.16);box-shadow:inset 0 0 0 1px rgba(255,107,107,.32)}
.pill.pending{color:var(--amber);background:rgba(255,193,69,.14);box-shadow:inset 0 0 0 1px rgba(255,193,69,.3)}
.pill.void,.pill.unknown{color:var(--grey);background:rgba(107,118,137,.16);box-shadow:inset 0 0 0 1px rgba(107,118,137,.3)}
.bar{display:flex;align-items:center;gap:8px;min-width:100px}
.bar-track{flex:1;height:6px;background:var(--bg2);border-radius:999px;overflow:hidden;min-width:50px}
.bar-fill{height:100%;background:linear-gradient(90deg,var(--green),#8ef0bf);border-radius:999px}
.bar-lbl{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.match{font-weight:500}.match .vs{color:var(--muted);font-size:11px;padding:0 2px}
.score{margin-left:5px;font-size:11px;color:var(--muted);background:var(--bg2);padding:1px 6px;border-radius:5px;font-weight:600}
.tip{color:#cdd6e6}.odd{font-variant-numeric:tabular-nums;font-weight:700}.own{font-weight:500;font-size:12px}.kt{color:var(--muted);font-size:11px}
footer{color:var(--muted);margin-top:30px;font-size:11px;line-height:1.6;border-top:1px solid var(--line);padding-top:14px}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<header>
  <h1><span class="logo">⚽</span> SoccerVital Tracker</h1>
  <div class="sub">${deDate(dates[0])} – ${deDate(dates.at(-1))} · <b>${rows.length}</b> Picks<br>
    aktualisiert ${new Date().toLocaleString('de-DE')} &nbsp;<a class="back" href="/">← Hauptdashboard</a></div>
</header>

<div class="cards">
  <div class="card ${won > lost ? 'pos' : ''}"><div class="v">${won}<span class="muted" style="font-size:15px">/${won + lost}</span></div><div class="l">Treffer (abgerechnet)</div></div>
  <div class="card ${winRate !== null && Number(winRate) >= 50 ? 'pos' : winRate !== null ? 'neg' : ''}"><div class="v">${winRate !== null ? winRate + '%' : '—'}</div><div class="l">Trefferquote</div></div>
  <div class="card"><div class="v" style="color:var(--amber)">${pending}</div><div class="l">offen</div></div>
  <div class="card"><div class="v">${settled.length}</div><div class="l">abgerechnet</div></div>
</div>

<h2>Nach Markt</h2>
<div class="scroll"><table><thead><tr><th>Markt</th><th>Trefferquote</th><th>Quote %</th><th>offen</th></tr></thead><tbody>${mktRows}</tbody></table></div>

<h2>Alle Picks</h2>
<div class="scroll"><table><thead><tr><th>Datum</th><th>Spiel</th><th>Tipp</th><th>Quote</th><th>Ergebnis</th></tr></thead><tbody>${tipRows}</tbody></table></div>

<footer>Picks: Bankers (Konfidenz 8-10/10) · SoccerVital eigene Quoten + Bet365-Referenz in Klammern · Auto-Refresh 5 Min</footer>
</div></body></html>`;
}

function html() {
  const db = openDb();
  const rows = db.prepare(`SELECT * FROM tips WHERE source NOT IN ('${SV_SOURCE}', '${SV2_SOURCE}') ORDER BY match_date DESC, CASE WHEN kickoff IS NULL THEN 1 ELSE 0 END, kickoff ASC, source`).all();
  db.close();
  const units = toUnits(rows);
  const { overall, bySource } = aggregate(units);
  const byMarket = marketStats(rows);
  const settled = overall.won + overall.lost + overall.void;
  const dates = rows.map((t) => t.match_date).filter(Boolean).sort();
  const combos = units.filter((u) => u.kind === 'combo');
  const sources = new Set(rows.map((t) => t.source));
  const roiAll = roiNum(overall);

  // Kombis (BetMines Daily Double/Risk etc.)
  const comboRows = combos.map((c) => {
    const legs = c.legs.map((l) => `<span class="leg">${esc(l.home)} / ${esc(l.away)} · <b>${esc(tipLabel(l.market || l.market_raw))}</b></span>`).join('<span class="plus">+</span>');
    const ckt = kickoffTime(c.kickoff);
    return `<tr><td class="nowrap">${deDate(c.match_date)}${ckt ? ` <span class="kt">${ckt}</span>` : ''}</td><td>${srcBadge(c.source)}</td>` +
      `<td><span class="badge type">${esc(c.slip_type)}</span></td><td class="legs">${legs}</td>` +
      `<td class="odd">${c.odds ?? ''}</td><td>${pill(c.result)}</td></tr>`;
  }).join('');

  // Einzeltipps
  const singles = rows.filter((t) => !t.slip_ref).slice(0, 80).map((t) => {
    const sc = t.ft_home != null ? `<span class="score">${t.ft_home}–${t.ft_away}</span>` : '';
    const r = t.result || 'pending';
    const oddCell = t.ref_odds != null
      ? `<b class="odd">${t.ref_odds}</b>${t.odds != null && t.odds !== t.ref_odds ? ` <span class="muted own">(${t.odds})</span>` : ''}`
      : (t.odds != null ? `<span class="odd">${t.odds}</span>` : '<span class="muted">–</span>');
    const kt = kickoffTime(t.kickoff);
    return `<tr><td class="nowrap">${deDate(t.match_date)}${kt ? ` <span class="kt">${kt}</span>` : ''}</td><td>${srcBadge(t.source)}</td>` +
      `<td class="match">${esc(t.home)} <span class="vs">vs</span> ${esc(t.away)}${sc}</td>` +
      `<td><span class="tip">${esc(t.market_raw || tipLabel(t.market) || '?')}</span></td>` +
      `<td>${oddCell}</td><td>${pill(r)}</td></tr>`;
  }).join('');

  const srcRows = [...bySource].sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost) || b[1].pending - a[1].pending).map(([k, s]) => srcRow(k, s)).join('');
  const mkRows = [...byMarket].filter(([, s]) => s.won + s.lost).sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost)).map(([k, s]) => srcRow(k, s)).join('');

  const roiCardCls = roiAll == null ? '' : roiAll >= 0 ? 'pos' : 'neg';

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>Tipp-Tracker</title><style>
:root{
  /* Bet365-Look: sehr dunkles Grün + gelbe Akzente */
  --bg:#04140d; --bg2:#061b12; --panel:#082318; --panel2:#0b3122; --line:#13402d;
  --txt:#eafff5; --muted:#79a892; --accent:#ffdf1b; --accent2:#0f5e42;
  --green:#2fe08a; --red:#ff6b6b; --amber:#ffdf1b; --grey:#5f8473;
  color-scheme:dark;
}
*{box-sizing:border-box}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0;
  background:radial-gradient(1200px 600px at 50% -200px,#0d4a33 0,var(--bg) 55%);color:var(--txt);min-height:100vh}
.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
h1{font-size:24px;font-weight:800;margin:0;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
h1 .logo{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;
  background:var(--accent2);border:2px solid var(--accent);font-size:15px;box-shadow:0 4px 14px rgba(255,223,27,.3)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin:34px 0 12px}
.sub{color:var(--muted);font-size:12.5px;text-align:right}
.sub b{color:var(--txt);font-weight:600}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:20px}
.card{position:relative;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
  border-radius:16px;padding:16px 18px;overflow:hidden}
.card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--accent)}
.card.pos::before{background:var(--green)}.card.neg::before{background:var(--red)}
.card .v{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.card .l{color:var(--muted);font-size:12px;margin-top:3px;font-weight:500}
.card.pos .v{color:var(--green)}.card.neg .v{color:var(--red)}

table{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel);
  border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
th{background:var(--bg2);color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
tbody tr{transition:background .12s}
tbody tr:hover{background:var(--panel2)}
.nowrap{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.pos{color:var(--green);font-weight:600}.neg{color:var(--red);font-weight:600}

.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
.badge.src{color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent);
  border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}
.badge.type{color:#0a3d2c;background:var(--accent);border:1px solid var(--accent);font-weight:700;text-transform:capitalize}

.pill{display:inline-block;padding:3px 11px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.01em}
.pill.sm{padding:1px 9px;font-weight:600}
.pill.won{background:rgba(57,217,138,.16);box-shadow:inset 0 0 0 1px rgba(57,217,138,.35);color:var(--green)}
.pill.lost{color:var(--red);background:rgba(255,107,107,.16);box-shadow:inset 0 0 0 1px rgba(255,107,107,.32)}
.pill.pending{color:var(--amber);background:rgba(255,193,69,.14);box-shadow:inset 0 0 0 1px rgba(255,193,69,.3)}
.pill.void,.pill.unknown{color:var(--grey);background:rgba(107,118,137,.16);box-shadow:inset 0 0 0 1px rgba(107,118,137,.3)}

.bar{display:flex;align-items:center;gap:9px;min-width:120px}
.bar-track{flex:1;height:7px;background:var(--bg2);border-radius:999px;overflow:hidden;min-width:60px}
.bar-fill{height:100%;background:linear-gradient(90deg,var(--green),#8ef0bf);border-radius:999px}
.bar-lbl{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}

.match{font-weight:500}.match .vs{color:var(--muted);font-size:11px;padding:0 2px}
.score{margin-left:6px;font-size:11px;color:var(--muted);background:var(--bg2);padding:1px 7px;border-radius:6px;font-weight:600}
.tip{color:#cdd6e6}
.odd{font-variant-numeric:tabular-nums;font-weight:700}
.own{font-weight:500;font-size:12px}
.legs{font-size:12.5px}.leg{color:#cdd6e6}.leg b{color:var(--txt)}
.plus{color:var(--accent);font-weight:800;padding:0 7px}

footer{color:var(--muted);margin-top:34px;font-size:11.5px;line-height:1.6;
  border-top:1px solid var(--line);padding-top:16px}
.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.nav a{font-size:12px;color:var(--muted);text-decoration:none;padding:4px 12px;border:1px solid var(--line);border-radius:6px}
.nav a:hover{color:var(--txt);border-color:var(--accent)}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<header>
  <div>
    <h1><span class="logo">⚽</span> Tipp-Tracker</h1>
    <nav class="nav"><a href="/soccervista">SoccerVista</a><a href="/soccervital">SoccerVital</a></nav>
  </div>
  <div class="sub">${deDate(dates[0])} – ${deDate(dates.at(-1))} · <b>${sources.size}</b> Quellen · <b>${rows.length}</b> Selektionen · <b>${units.length}</b> Wetten (${combos.length} Kombis)<br>aktualisiert ${new Date().toLocaleString('de-DE')}</div>
</header>

<div class="cards">
  <div class="card"><div class="v">${overall.won}<span class="muted" style="font-size:16px">/${overall.won + overall.lost}</span></div><div class="l">Treffer · ${pct(overall.won, overall.won + overall.lost)}</div></div>
  <div class="card ${roiCardCls}"><div class="v">${roiOf(overall)}</div><div class="l">ROI (1u je Wette)</div></div>
  <div class="card"><div class="v">${settled}</div><div class="l">abgerechnet</div></div>
  <div class="card"><div class="v" style="color:var(--amber)">${overall.pending}</div><div class="l">offen</div></div>
</div>

<h2>Nach Quelle</h2>
<div class="scroll"><table><thead><tr><th>Quelle</th><th>Trefferquote</th><th>Quote</th><th>ROI</th><th>offen</th></tr></thead><tbody>${srcRows}</tbody></table></div>

${comboRows ? `<h2>Kombis</h2><div class="scroll"><table><thead><tr><th>Datum</th><th>Quelle</th><th>Typ</th><th>Legs</th><th>Quote</th><th>Ergebnis</th></tr></thead><tbody>${comboRows}</tbody></table></div>` : ''}

${mkRows ? `<h2>Nach Markt</h2><div class="scroll"><table><thead><tr><th>Markt</th><th>Trefferquote</th><th>Quote</th><th>ROI</th><th>offen</th></tr></thead><tbody>${mkRows}</tbody></table></div>` : ''}

<h2>Einzeltipps</h2>
<div class="scroll"><table><thead><tr><th>Datum</th><th>Quelle</th><th>Spiel</th><th>Tipp</th><th>Quote (Ref)</th><th>Ergebnis</th></tr></thead><tbody>${singles}</tbody></table></div>

<footer>ROI auf Basis einheitlicher Referenzquote (API-Football · Bet365) je Spiel + Markt; Eigenquote der Quelle in Klammern.<br>Auto-Refresh alle 5 Min · nur zu Analysezwecken.</footer>
</div></body></html>`;
}

export function startServer(port = 8080) {
  createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
    const fn = req.url === '/soccervista' || req.url === '/soccervista/' ? svHtml
      : req.url === '/soccervital' || req.url === '/soccervital/' ? sv2Html
      : html;
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fn());
    } catch (e) {
      res.writeHead(500); res.end('Fehler: ' + e.message);
    }
  }).listen(port, () => console.log(`[dashboard] http://0.0.0.0:${port}`));
}

// Direktstart: node server.mjs
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  startServer(Number(process.env.PORT || process.env.DASHBOARD_PORT) || 8080);
}
