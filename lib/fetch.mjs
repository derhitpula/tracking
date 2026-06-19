// HTTP-Helfer: native fetch, sonst curl-Fallback (umgeht TLS-/Bot-Filter).
import { execFileSync } from 'node:child_process';
import { fetchViaBrowser } from './browser.mjs';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Cloudflare-/Bot-Challenge-Seiten erkennen (nicht echter Seiteninhalt).
// Enthält klassische + moderne CF-Varianten (Turnstile, Managed Challenge, etc.)
const CF_MARK = /Just a moment|cf-browser-verification|__cf_chl|cdn-cgi\/challenge-platform|Attention Required.{0,40}Cloudflare|Enable JavaScript and cookies to continue|Verifying you are human|_cf_chl_opt|cf-turnstile|Ray ID: [0-9a-f]{16}|no-js ie6 oldie/i;

// Strikte Prüfung für Fallback-Ergebnisse: nur echte WAF-Blockseiten ablehnen.
// Echte Seiten mit CF-CDN können __cf_chl, cf-turnstile etc. im normalen HTML haben.
const BLOCK_PAGE = /class="no-js ie6 oldie"|<title>\s*Just a moment|Attention Required.{0,80}Cloudflare|Enable JavaScript and cookies to continue|Verifying you are human/is;

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

// Proxy als FlareSolverr-Objekt (mit getrennten Auth-Feldern, am kompatibelsten)
function proxyObj() {
  const p = pickProxy(); if (!p) return null;
  const m = p.match(/^(\w+):\/\/(?:([^:@]+):([^@]+)@)?(.+)$/);
  if (!m) return { url: p };
  const o = { url: `${m[1]}://${m[4]}` };
  if (m[2]) { o.username = m[2]; o.password = m[3]; }
  return o;
}

// Über FlareSolverr (löst Cloudflare per echtem Browser). Nur wenn konfiguriert.
// Nutzt zusätzlich den Proxy (FlareSolverr löst die Challenge über die Wohn-IP).
async function viaSolver(url) {
  const base = (process.env.FLARESOLVERR_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const body = { cmd: 'request.get', url, maxTimeout: 60000 };
  const proxy = proxyObj(); if (proxy) body.proxy = proxy;
  const res = await fetch(`${base}/v1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.solution?.response || null;
}

export async function fetchHtml(url) {
  const html = await rawFetch(url);
  // Cloudflare-Sperre erkannt -> in dieser Reihenfolge versuchen:
  //   FlareSolverr (falls gesetzt) -> echter Browser (Playwright, falls installiert)
  //   -> reiner Proxy (reicht bei JS-Challenges meist nicht). Alle nutzen den Proxy.
  if (CF_MARK.test(html)) {
    for (const fn of [viaSolver, fetchViaBrowser, viaProxy]) {
      try { const r = await fn(url); if (r && !BLOCK_PAGE.test(r)) return r; } catch { /* nächster Versuch */ }
    }
  }
  return html;
}

// Kleine Helfer fürs HTML-Parsing ohne externe Libs
export const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&#x?[0-9a-f]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
