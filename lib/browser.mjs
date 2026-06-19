// Echter Headless-Browser (Playwright) als letzter Ausweg gegen Cloudflare-
// JS-Challenges – läuft nativ auf Windows (kein Docker/keine Virtualisierung).
// Playwright ist optional: ist es nicht installiert, liefert das hier null und
// der Tracker läuft normal weiter.
//
// Cookie-Persistenz: nach dem ersten Lösen einer Managed Challenge wird der
// cf_clearance-Cookie pro Domain auf Platte gespeichert (data/cf_state). Beim
// nächsten Abruf wird er wiederverwendet -> die ~3-Minuten-Challenge entfällt,
// solange der Cookie gültig ist (typ. ~30 min – einige Stunden).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CF_MARK = /Just a moment|cf-browser-verification|__cf_chl|cdn-cgi\/challenge-platform|Attention Required.{0,40}Cloudflare|Enable JavaScript and cookies to continue|Verifying you are human|_cf_chl_opt|cf-turnstile|Ray ID: [0-9a-f]{16}/i;

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cf_state');

// gespeicherten storageState (Cookies) pro Host laden / sichern
function stateFile(url) {
  try { return join(STATE_DIR, new URL(url).hostname.replace(/[^\w.-]/g, '_') + '.json'); }
  catch { return null; }
}
function loadState(url) {
  const f = stateFile(url);
  if (f && existsSync(f)) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch {} }
  return undefined;
}
function saveState(url, state) {
  const f = stateFile(url); if (!f) return;
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(f, JSON.stringify(state)); } catch {}
}

// BROWSER_PROXY_URL überschreibt den Proxy nur für den Browser (optional).
// Standardmäßig kein Proxy im Browser – die VPS-IP wird von CF nicht geblockt
// und ein Proxy macht es eher schlimmer (Proxy-IPs gelten CF als verdächtiger).
function pwProxy() {
  const raw = process.env.BROWSER_PROXY_URL || '';
  if (!raw) return undefined;
  const p = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const u = p[Math.floor(Math.random() * p.length)];
  const m = u.match(/^(\w+):\/\/(?:([^:@]+):([^@]+)@)?(.+)$/);
  if (!m) return { server: u };
  const o = { server: `${m[1]}://${m[4]}` };
  if (m[2]) { o.username = m[2]; o.password = m[3]; }
  return o;
}

// Bekannte Firefox-Installationspfade auf Windows (echter Browser = nicht detektierbar)
const FF_PATHS = [
  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
];

let _pw = null; // gecachtes playwright-Modul
async function getPw() {
  if (_pw) return _pw;
  // patchright bevorzugen (gepatchtes Chromium-Binary)
  try { _pw = await import('patchright'); return _pw; } catch {}
  // playwright-extra + Stealth
  try {
    const m = await import('playwright-extra');
    const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
    m.chromium.use(stealth());
    _pw = m;
    return _pw;
  } catch {}
  // Standard playwright
  try { _pw = await import('playwright'); return _pw; } catch {}
  return null;
}

async function launchBrowser(pw, useFirefox, sysFfPath, storageState) {
  const proxy = pwProxy();
  const ctxOpts = { viewport: { width: 1366, height: 768 }, locale: 'en-GB',
    timezoneId: 'Europe/London', ...(storageState ? { storageState } : {}), ...(proxy ? { proxy } : {}) };

  if (useFirefox) {
    // Firefox: kein Stealth nötig – CF erkennt Firefox-headless deutlich seltener
    const launchOpts = { headless: true };
    if (sysFfPath) launchOpts.executablePath = sysFfPath; // echte Firefox-Binary
    const browser = await pw.firefox.launch(launchOpts);
    const ctx = await browser.newContext(ctxOpts);
    return { browser, ctx };
  }

  // Chromium / patchright
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ userAgent: UA, ...ctxOpts });
  return { browser, ctx };
}

async function tryFetch(pw, useFirefox, sysFfPath, url) {
  const storageState = loadState(url); // gespeicherte cf_clearance-Cookies (falls vorhanden)
  const { browser, ctx } = await launchBrowser(pw, useFirefox, sysFfPath, storageState);
  try {
    const page = await ctx.newPage();
    // domcontentloaded: kehrt schnell zurück -> Polling startet sofort (CF-JS läuft
    // im Hintergrund weiter). networkidle wäre verschwendet, weil die Challenge-Seite
    // dauernd pollt und nie "idle" wird.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    // Kurz warten damit CSR-Seiten (React/WP-Ajax) nach domcontentloaded hydratisieren können.
    await new Promise((r) => setTimeout(r, 3000));
    // CF Managed Challenge braucht real ~3 min -> bis zu 240 s pollen (80 × 3 s).
    // Mit gültigem Cookie ist die Seite schon beim ersten Durchlauf sauber.
    for (let i = 0; i < 80; i++) {
      const html = await page.content();
      if (!CF_MARK.test(html)) {
        // Challenge gelöst (oder Cookie war gültig) -> Cookies für nächstes Mal sichern
        try { saveState(url, await ctx.storageState()); } catch {}
        return html;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return await page.content();
  } finally { await browser.close().catch(() => {}); }
}

export async function fetchViaBrowser(url) {
  const pw = await getPw();
  if (!pw) return null;

  const sysFfPath = FF_PATHS.find(existsSync) || null;

  // 1. Firefox – echte Binary bevorzugen, dann Playwright-Firefox (falls installiert)
  try {
    if (sysFfPath || pw.firefox) {
      const html = await tryFetch(pw, true, sysFfPath, url);
      if (html && !CF_MARK.test(html)) return html;
    }
  } catch { /* Firefox nicht verfügbar -> Chromium */ }

  // 2. Chromium (patchright / stealth / pur)
  return tryFetch(pw, false, null, url).catch(() => null);
}
