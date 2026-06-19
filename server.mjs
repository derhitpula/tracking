// Leichtgewichtiges Web-Dashboard (ohne externe Pakete).
// Zeigt Report, Quellen-/Markt-Vergleich und die letzten Tipps.
import { createServer } from 'node:http';
import { openDb } from './lib/db.mjs';
import { tipLabel } from './lib/markets.mjs';

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '–');
const signed = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
const roiOf = (s) => (s.stake ? signed(100 * (s.ret - s.stake) / s.stake) + '%' : '–');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function stats(rows) {
  const blank = () => ({ won: 0, lost: 0, void: 0, pending: 0, unknown: 0, stake: 0, ret: 0 });
  const add = (s, r, odds) => {
    s[r] = (s[r] ?? 0) + 1;
    if (r === 'won' || r === 'lost' || r === 'void') { s.stake++; s.ret += r === 'won' ? (odds || 0) : r === 'void' ? 1 : 0; }
  };
  const overall = blank(), bySource = new Map(), byMarket = new Map();
  const slot = (m, k) => { if (!m.has(k)) m.set(k, blank()); return m.get(k); };
  for (const t of rows) {
    const r = t.result || 'pending';
    add(overall, r, t.odds); add(slot(bySource, t.source), r, t.odds);
    if (t.market) add(slot(byMarket, tipLabel(t.market)), r, t.odds);
  }
  return { overall, bySource, byMarket };
}

function row(name, s) {
  const st = s.won + s.lost;
  const cls = s.stake && s.ret - s.stake > 0 ? 'pos' : s.stake && s.ret - s.stake < 0 ? 'neg' : '';
  return `<tr><td>${esc(name)}</td><td>${s.won}/${st}</td><td>${pct(s.won, st)}</td>` +
    `<td class="${cls}">${roiOf(s)}</td><td>${s.pending}</td></tr>`;
}

function html() {
  const db = openDb();
  const rows = db.prepare('SELECT * FROM tips ORDER BY match_date DESC, source').all();
  db.close();
  const { overall, bySource, byMarket } = stats(rows);
  const settled = overall.won + overall.lost + overall.void;
  const dates = rows.map((t) => t.match_date).filter(Boolean).sort();
  const recent = rows.slice(0, 60).map((t) => {
    const sc = t.ft_home != null ? ` (${t.ft_home}-${t.ft_away})` : '';
    const r = t.result || 'pending';
    return `<tr class="r-${r}"><td>${esc(t.match_date)}</td><td>${esc(t.source)}</td>` +
      `<td>${esc(t.home)} vs ${esc(t.away)}${sc}</td><td>${esc(t.market_raw || '?')}</td>` +
      `<td>${t.odds ?? ''}</td><td><b>${r}</b></td></tr>`;
  }).join('');
  const srcRows = [...bySource].sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost)).map(([k, s]) => row(k, s)).join('');
  const mkRows = [...byMarket].map(([k, s]) => [k, s]).filter(([, s]) => s.won + s.lost).sort((a, b) => (b[1].won + b[1].lost) - (a[1].won + a[1].lost)).map(([k, s]) => row(k, s)).join('');

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>Tipp-Tracker</title><style>
:root{color-scheme:dark}body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;color:#9ad}
.sub{color:#888;font-size:12px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}
.card{background:#181b22;border:1px solid #262b36;border-radius:10px;padding:14px 18px;min-width:120px}
.card .v{font-size:22px;font-weight:700}.card .l{color:#8a93a6;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:6px;background:#161922;border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #232938;font-size:13px}
th{background:#1d2230;color:#9aa7bd;font-weight:600}
.pos{color:#4ade80}.neg{color:#f87171}
.r-won b{color:#4ade80}.r-lost b{color:#f87171}.r-pending b{color:#fbbf24}.r-unknown b{color:#888}
footer{color:#667;margin-top:24px;font-size:11px}
</style></head><body><div class="wrap">
<h1>⚽ Multi-Source Tipp-Tracker</h1>
<div class="sub">Zeitraum ${dates[0] ?? '?'} … ${dates.at(-1) ?? '?'} · ${rows.length} Tipps · aktualisiert ${new Date().toLocaleString('de-DE')}</div>
<div class="cards">
<div class="card"><div class="v">${overall.won}/${overall.won + overall.lost}</div><div class="l">Treffer (${pct(overall.won, overall.won + overall.lost)})</div></div>
<div class="card"><div class="v ${overall.stake && overall.ret - overall.stake >= 0 ? 'pos' : 'neg'}">${roiOf(overall)}</div><div class="l">ROI (flat 1u)</div></div>
<div class="card"><div class="v">${settled}</div><div class="l">abgerechnet</div></div>
<div class="card"><div class="v">${overall.pending}</div><div class="l">offen</div></div>
</div>
<h2>Nach Quelle</h2><table><tr><th>Quelle</th><th>Treffer</th><th>Quote</th><th>ROI</th><th>offen</th></tr>${srcRows}</table>
${mkRows ? `<h2>Nach Markt</h2><table><tr><th>Markt</th><th>Treffer</th><th>Quote</th><th>ROI</th><th>offen</th></tr>${mkRows}</table>` : ''}
<h2>Letzte Tipps</h2><table><tr><th>Datum</th><th>Quelle</th><th>Spiel</th><th>Tipp</th><th>Quote</th><th>Ergebnis</th></tr>${recent}</table>
<footer>Auto-Refresh alle 5 Min · nur zu Analysezwecken</footer>
</div></body></html>`;
}

export function startServer(port = 8080) {
  createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html());
    } catch (e) {
      res.writeHead(500); res.end('Fehler: ' + e.message);
    }
  }).listen(port, () => console.log(`[dashboard] http://0.0.0.0:${port}`));
}

// Direktstart: node server.mjs
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  startServer(Number(process.env.PORT) || 8080);
}
