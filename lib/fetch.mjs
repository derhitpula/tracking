// HTTP-Helfer: native fetch, sonst curl-Fallback (umgeht TLS-/Bot-Filter).
import { execFileSync } from 'node:child_process';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Cloudflare-/Bot-Challenge-Seiten erkennen (nicht echter Seiteninhalt)
const CF_MARK = /Just a moment|cf-browser-verification|__cf_chl|cdn-cgi\/challenge-platform|Attention Required.{0,40}Cloudflare/i;

// Roh-Abruf: curl zuerst (zuverlässiger gegen TLS-Filter), sonst native fetch
async function rawFetch(url) {
  try {
    const txt = execFileSync('curl', ['-s', '-L', '-A', UA, '-H', 'Accept: text/html',
      '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (txt && txt.length > 500) return txt;
  } catch { /* fetch-Fallback */ }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Über Proxy (residential IP) per curl. PROXY_URL darf mehrere, komma-getrennte
// Proxys enthalten -> zufällige Rotation pro Anfrage.
function pickProxy() {
  const list = (process.env.PROXY_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}
async function viaProxy(url) {
  const proxy = pickProxy();
  if (!proxy) return null;
  try {
    const txt = execFileSync('curl', ['-s', '-L', '-A', UA, '--proxy', proxy,
      '--max-time', '45', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return txt && txt.length > 500 ? txt : null;
  } catch { return null; }
}

// Über FlareSolverr (löst Cloudflare per echtem Browser). Nur wenn konfiguriert.
async function viaSolver(url) {
  const base = (process.env.FLARESOLVERR_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const res = await fetch(`${base}/v1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.solution?.response || null;
}

export async function fetchHtml(url) {
  const html = await rawFetch(url);
  // Cloudflare-Sperre erkannt -> über Proxy (residential IP), sonst FlareSolverr
  if (CF_MARK.test(html)) {
    for (const fn of [viaProxy, viaSolver]) {
      try { const r = await fn(url); if (r && !CF_MARK.test(r)) return r; } catch { /* nächster Versuch */ }
    }
  }
  return html;
}

// Kleine Helfer fürs HTML-Parsing ohne externe Libs
export const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&#x?[0-9a-f]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
