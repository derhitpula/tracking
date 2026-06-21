// Leichtgewichtiges Web-Dashboard (ohne externe Pakete) auf dem v2-Schema.
// Drei Ansichten teilen sich Layout/CSS: Haupt (alle außer SV*), SoccerVista,
// SoccerVital. Daten kommen aus repo.dashboardRows().
import { createServer } from 'node:http';
import { openDb } from './lib/db.mjs';
import { dashboardRows } from './lib/repo.mjs';
import { marketLabel } from './lib/markets.mjs';

// SoccerVista/SoccerVital laufen als eigene Ansichten und werden im Haupt-Dashboard ausgeblendet.
const OWN_VIEWS = { soccervista: 'SoccerVista', soccervital: 'SoccerVital' };

// --- Format-Helfer -----------------------------------------------------------
const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '–');
const signed = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const deDate = (iso) => { const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : '?'; };

// UTC-Kickoff -> HH:MM in echter Europe/Berlin-Zeit (CET/CEST mit DST).
const kickoffTime = (iso) => {
  if (!iso) return '';
  let s = String(iso).trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2');
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
};

function srcColor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 60% 62%)`;
}
const srcBadge = (n) => `<span class="badge src" style="--c:${srcColor(n)}">${esc(n)}</span>`;
const label = (r) => esc(r.market_code ? marketLabel(r.market_code) : (r.selection || '?'));

function pill(r) {
  const map = { won: ['Gewonnen', 'won'], lost: ['Verloren', 'lost'], void: ['Void', 'void'] };
  const [t, c] = map[r] || ['Offen', 'pending'];
  return `<span class="pill ${c}">${t}</span>`;
}
function bar(won, lost) {
  const tot = won + lost;
  if (!tot) return '<div class="bar"><span class="muted">–</span></div>';
  return `<div class="bar"><div class="bar-track"><div class="bar-fill" style="width:${(100 * won / tot).toFixed(0)}%"></div></div>` +
    `<span class="bar-lbl">${won}/${tot}</span></div>`;
}
const scoreCell = (r) => (r.fh != null ? `<span class="score">${r.fh}–${r.fa}</span>` : '');
const oddCell = (r) => (r.ref_odds != null
  ? `<b class="odd">${r.ref_odds}</b>${r.odds != null && r.odds !== r.ref_odds ? ` <span class="muted own">(${r.odds})</span>` : ''}`
  : (r.odds != null ? `<span class="odd">${r.odds}</span>` : '<span class="muted">–</span>'));

// --- Aggregation -------------------------------------------------------------
// CLV (Closing Line Value) eines Tipps in %: wie viel besser war die gespielte
// Quote gegenüber der Marktschlussquote. >0 = Value.
const clvOf = (r) => (r.odds && r.closing_odds ? (r.odds / r.closing_odds - 1) * 100 : null);

function aggregate(rows) {
  const by = new Map();
  const all = { won: 0, lost: 0, void: 0, pending: 0, profit: 0, clvSum: 0, clvN: 0 };
  for (const r of rows) {
    const k = r.result || 'pending';
    const s = by.get(r.source) || { won: 0, lost: 0, void: 0, pending: 0, profit: 0, clvSum: 0, clvN: 0 };
    s[k]++; all[k]++;
    s.profit += r.profit || 0; all.profit += r.profit || 0;
    const c = clvOf(r);
    if (c != null) { s.clvSum += c; s.clvN++; all.clvSum += c; all.clvN++; }
    by.set(r.source, s);
  }
  return { all, by };
}
const roi = (s) => { const st = s.won + s.lost; return st ? signed(100 * s.profit / st) + '%' : '–'; };
const roiCls = (s) => { const st = s.won + s.lost; return !st ? 'muted' : s.profit > 0 ? 'pos' : s.profit < 0 ? 'neg' : ''; };
const clvAvg = (s) => (s.clvN ? signed(s.clvSum / s.clvN) + '%' : '–');
const clvCls = (s) => (!s.clvN ? 'muted' : s.clvSum > 0 ? 'pos' : s.clvSum < 0 ? 'neg' : '');

function statRow(name, s) {
  return `<tr><td>${srcBadge(name)}</td><td>${bar(s.won, s.lost)}</td>` +
    `<td>${pct(s.won, s.won + s.lost)}</td><td class="${roiCls(s)}">${roi(s)}</td>` +
    `<td class="${clvCls(s)}">${clvAvg(s)}</td>` +
    `<td><span class="pill pending sm">${s.pending}</span></td></tr>`;
}

// chronologisch: Datum + Anstoß aufsteigend, NULL-Kickoff ans Ende
const byKickoff = (a, b) => String(b.match_date).localeCompare(String(a.match_date)) ||
  (b.kickoff ? 1 : 0) - (a.kickoff ? 1 : 0) || String(b.kickoff).localeCompare(String(a.kickoff));

// --- gemeinsames CSS ---------------------------------------------------------
const CSS = `:root{--bg:#04140d;--bg2:#061b12;--panel:#082318;--panel2:#0b3122;--line:#13402d;
--txt:#eafff5;--muted:#79a892;--accent:#ffdf1b;--accent2:#0f5e42;--green:#2fe08a;--red:#ff6b6b;--amber:#ffdf1b;--grey:#5f8473;color-scheme:dark}
*{box-sizing:border-box}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0;
background:radial-gradient(1200px 600px at 50% -200px,#0d4a33 0,var(--bg) 55%);color:var(--txt);min-height:100vh}
.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
h1{font-size:23px;font-weight:800;margin:0;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
h1 .logo{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;
background:var(--accent2);border:2px solid var(--accent);font-size:15px;box-shadow:0 4px 14px rgba(255,223,27,.3)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin:32px 0 12px}
.sub{color:var(--muted);font-size:12.5px;text-align:right}.sub b{color:var(--txt);font-weight:600}
.back,.nav a{font-size:12px;color:var(--muted);text-decoration:none;padding:4px 12px;border:1px solid var(--line);border-radius:6px}
.back:hover,.nav a:hover{color:var(--txt);border-color:var(--accent)}
.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:20px}
.card{position:relative;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
border-radius:16px;padding:16px 18px;overflow:hidden}
.card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--accent)}
.card.pos::before{background:var(--green)}.card.neg::before{background:var(--red)}
.card .v{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.card .l{color:var(--muted);font-size:12px;margin-top:3px;font-weight:500}
.card.pos .v{color:var(--green)}.card.neg .v{color:var(--red)}
table{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
th{background:var(--bg2);color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
tbody tr:hover{background:var(--panel2)}
.nowrap{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.pos{color:var(--green);font-weight:600}.neg{color:var(--red);font-weight:600}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
.badge.src{color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent);border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}
.badge.type{color:#0a3d2c;background:var(--accent);border:1px solid var(--accent);font-weight:700;text-transform:capitalize}
.pill{display:inline-block;padding:3px 11px;border-radius:999px;font-size:11.5px;font-weight:700}
.pill.sm{padding:1px 9px;font-weight:600}
.pill.won{background:rgba(57,217,138,.16);box-shadow:inset 0 0 0 1px rgba(57,217,138,.35);color:var(--green)}
.pill.lost{color:var(--red);background:rgba(255,107,107,.16);box-shadow:inset 0 0 0 1px rgba(255,107,107,.32)}
.pill.pending{color:var(--amber);background:rgba(255,193,69,.14);box-shadow:inset 0 0 0 1px rgba(255,193,69,.3)}
.pill.void{color:var(--grey);background:rgba(107,118,137,.16);box-shadow:inset 0 0 0 1px rgba(107,118,137,.3)}
.bar{display:flex;align-items:center;gap:9px;min-width:120px}
.bar-track{flex:1;height:7px;background:var(--bg2);border-radius:999px;overflow:hidden;min-width:60px}
.bar-fill{height:100%;background:linear-gradient(90deg,var(--green),#8ef0bf);border-radius:999px}
.bar-lbl{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.match{font-weight:500}.match .vs{color:var(--muted);font-size:11px;padding:0 2px}
.score{margin-left:6px;font-size:11px;color:var(--muted);background:var(--bg2);padding:1px 7px;border-radius:6px;font-weight:600}
.tip{color:#cdd6e6}.odd{font-variant-numeric:tabular-nums;font-weight:700}.own{font-weight:500;font-size:12px}.kt{color:var(--muted);font-size:11px}
.legs{font-size:12.5px}.leg{color:#cdd6e6}.leg b{color:var(--txt)}.plus{color:var(--accent);font-weight:800;padding:0 7px}
.info{color:var(--muted);font-size:12px;margin-top:10px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
footer{color:var(--muted);margin-top:34px;font-size:11.5px;line-height:1.6;border-top:1px solid var(--line);padding-top:16px}
.scroll{overflow-x:auto}`;

const layout = (title, head, body) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="300">
<title>${title}</title><style>${CSS}</style></head><body><div class="wrap">${head}${body}</div></body></html>`;

const dateRange = (rows) => { const d = rows.map((r) => r.match_date).filter(Boolean).sort(); return `${deDate(d[0])} – ${deDate(d.at(-1))}`; };
const updated = () => new Date().toLocaleString('de-DE');
const datedRow = (r) => { const kt = kickoffTime(r.kickoff); return `${deDate(r.match_date)}${kt ? ` <span class="kt">${kt}</span>` : ''}`; };

// --- Haupt-Dashboard ---------------------------------------------------------
function mainHtml(db) {
  const rows = dashboardRows(db).filter((r) => !OWN_VIEWS[r.source]);
  if (!rows.length) return layout('Tipp-Tracker', '', '<p style="color:#ccc">Noch keine Daten. Erst <code>node track.mjs daily</code>.</p>');
  const { all, by } = aggregate(rows);

  // Kombis nach slip_ref gruppieren
  const comboMap = new Map();
  for (const r of rows) if (r.slip_ref) (comboMap.get(r.slip_ref) || comboMap.set(r.slip_ref, []).get(r.slip_ref)).push(r);
  const comboRows = [...comboMap.values()].sort((a, b) => byKickoff(a[0], b[0])).map((legs) => {
    const res = legs.some((l) => l.result === 'lost') ? 'lost' : legs.every((l) => l.result === 'won') ? 'won' : 'pending';
    const l0 = legs[0];
    const legsHtml = legs.map((l) => `<span class="leg">${esc(l.home)} / ${esc(l.away)} · <b>${label(l)}</b></span>`).join('<span class="plus">+</span>');
    return `<tr><td class="nowrap">${datedRow(l0)}</td><td>${srcBadge(l0.source)}</td>` +
      `<td><span class="badge type">${esc(l0.slip_type)}</span></td><td class="legs">${legsHtml}</td>` +
      `<td class="odd">${l0.slip_odds ?? ''}</td><td>${pill(res)}</td></tr>`;
  }).join('');

  const singles = rows.filter((r) => !r.slip_ref).sort((a, b) => String(b.match_date).localeCompare(String(a.match_date)) || byKickoff(a, b))
    .slice(0, 100).map((r) => `<tr><td class="nowrap">${datedRow(r)}</td><td>${srcBadge(r.source)}</td>` +
      `<td class="match">${esc(r.home)} <span class="vs">vs</span> ${esc(r.away)}${scoreCell(r)}</td>` +
      `<td><span class="tip">${label(r)}</span></td><td>${oddCell(r)}</td><td>${pill(r.result)}</td></tr>`).join('');

  const srcRows = [...by].sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost) || b[1].pending - a[1].pending)
    .map(([k, s]) => statRow(k, s)).join('');

  const settled = all.won + all.lost + all.void;
  const roiCardCls = !(all.won + all.lost) ? '' : all.profit >= 0 ? 'pos' : 'neg';
  const head = `<header><div><h1><span class="logo">⚽</span> Tipp-Tracker</h1>
    <nav class="nav"><a href="/soccervista">SoccerVista</a><a href="/soccervital">SoccerVital</a></nav></div>
    <div class="sub">${dateRange(rows)} · <b>${by.size}</b> Quellen · <b>${rows.length}</b> Tipps · <b>${comboMap.size}</b> Kombis<br>aktualisiert ${updated()}</div></header>`;
  const body = `<div class="cards">
    <div class="card"><div class="v">${all.won}<span class="muted" style="font-size:16px">/${all.won + all.lost}</span></div><div class="l">Treffer · ${pct(all.won, all.won + all.lost)}</div></div>
    <div class="card ${roiCardCls}"><div class="v">${roi(all)}</div><div class="l">ROI (1u je Wette)</div></div>
    <div class="card ${clvCls(all)}"><div class="v">${clvAvg(all)}</div><div class="l">Ø CLV (Value)</div></div>
    <div class="card"><div class="v" style="color:var(--amber)">${all.pending}</div><div class="l">offen</div></div></div>
    <h2>Nach Quelle</h2><div class="scroll"><table><thead><tr><th>Quelle</th><th>Trefferquote</th><th>Quote</th><th>ROI</th><th>CLV</th><th>offen</th></tr></thead><tbody>${srcRows}</tbody></table></div>
    ${comboRows ? `<h2>Kombis</h2><div class="scroll"><table><thead><tr><th>Datum</th><th>Quelle</th><th>Typ</th><th>Legs</th><th>Quote</th><th>Ergebnis</th></tr></thead><tbody>${comboRows}</tbody></table></div>` : ''}
    <h2>Einzeltipps</h2><div class="scroll"><table><thead><tr><th>Datum</th><th>Quelle</th><th>Spiel</th><th>Tipp</th><th>Quote (Ref)</th><th>Ergebnis</th></tr></thead><tbody>${singles}</tbody></table></div>
    <footer>ROI auf Basis einheitlicher Referenzquote (API-Football · Bet365) je Spiel + Markt; Eigenquote in Klammern.<br>Auto-Refresh alle 5 Min · nur zu Analysezwecken.</footer>`;
  return layout('Tipp-Tracker', head, body);
}

// --- Einzelquellen-Ansicht (SoccerVista / SoccerVital) ----------------------
function sourceHtml(db, key, title) {
  const rows = dashboardRows(db).filter((r) => r.source === key).sort(byKickoff);
  if (!rows.length) return layout(title, '', `<p style="color:#ccc">Noch keine Daten. Erst <code>node track.mjs collect ${key}</code>.</p>`);
  const { all } = aggregate(rows);
  const settled = all.won + all.lost;
  const winRate = settled ? (100 * all.won / settled).toFixed(1) : null;

  const tipRows = rows.slice(0, 200).map((r) => `<tr><td class="nowrap">${datedRow(r)}</td>` +
    `<td class="match">${esc(r.home)} <span class="vs">vs</span> ${esc(r.away)}${scoreCell(r)}</td>` +
    `<td><span class="tip">${label(r)}</span></td><td>${oddCell(r)}</td><td>${pill(r.result)}</td></tr>`).join('');

  const head = `<header><h1><span class="logo">⚽</span> ${title} Tracker</h1>
    <div class="sub">${dateRange(rows)} · <b>${rows.length}</b> Picks<br>aktualisiert ${updated()} &nbsp;<a class="back" href="/">← Hauptdashboard</a></div></header>`;
  const body = `<div class="cards">
    <div class="card ${all.won > all.lost ? 'pos' : ''}"><div class="v">${all.won}<span class="muted" style="font-size:15px">/${settled}</span></div><div class="l">Treffer (abgerechnet)</div></div>
    <div class="card ${winRate !== null && Number(winRate) >= 50 ? 'pos' : winRate !== null ? 'neg' : ''}"><div class="v">${winRate !== null ? winRate + '%' : '—'}</div><div class="l">Trefferquote</div></div>
    <div class="card ${roiCls(all)}"><div class="v">${roi(all)}</div><div class="l">ROI</div></div>
    <div class="card"><div class="v" style="color:var(--amber)">${all.pending}</div><div class="l">offen</div></div></div>
    <h2>Alle Picks</h2><div class="scroll"><table><thead><tr><th>Datum</th><th>Spiel</th><th>Tipp</th><th>Quote</th><th>Ergebnis</th></tr></thead><tbody>${tipRows}</tbody></table></div>
    <footer>Auto-Refresh alle 5 Min · nur zu Analysezwecken.</footer>`;
  return layout(`${title} Tracker`, head, body);
}

// --- Server ------------------------------------------------------------------
export function startServer(port = 8080) {
  createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
    const db = openDb();
    try {
      const path = req.url.replace(/\/$/, '');
      const view = Object.keys(OWN_VIEWS).find((k) => path === `/${k}`);
      const out = view ? sourceHtml(db, view, OWN_VIEWS[view]) : mainHtml(db);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(out);
    } catch (e) {
      res.writeHead(500); res.end('Fehler: ' + e.message);
    } finally { db.close(); }
  }).listen(port, () => console.log(`[dashboard] http://0.0.0.0:${port}`));
}

if (process.argv[1]?.endsWith('server.mjs')) {
  startServer(Number(process.env.PORT || process.env.DASHBOARD_PORT) || 8080);
}
