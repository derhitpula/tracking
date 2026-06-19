// Echter Headless-Browser (Playwright) als letzter Ausweg gegen Cloudflare-
// JS-Challenges – läuft nativ auf Windows (kein Docker/keine Virtualisierung).
// Playwright ist optional: ist es nicht installiert, liefert das hier null und
// der Tracker läuft normal weiter.
import { existsSync } from 'node:fs';

const CF_MARK = /Just a moment|cf-browser-verification|__cf_chl|cdn-cgi\/challenge-platform|Attention Required.{0,40}Cloudflare/i;

// PROXY_URL (komma-getrennt) -> zufälliger Playwright-Proxy { server, username, password }
function pwProxy() {
  const list = (process.env.PROXY_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return undefined;
  const p = list[Math.floor(Math.random() * list.length)];
  const m = p.match(/^(\w+):\/\/(?:([^:@]+):([^@]+)@)?(.+)$/);
  if (!m) return { server: p };
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

async function launchBrowser(pw, useFirefox, sysFfPath) {
  const proxy = pwProxy();
  const ctxOpts = { viewport: { width: 1366, height: 768 }, locale: 'en-GB',
    timezoneId: 'Europe/London', ...(proxy ? { proxy } : {}) };

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
  const { browser, ctx } = await launchBrowser(pw, useFirefox, sysFfPath);
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 16; i++) {
      const html = await page.content();
      if (!CF_MARK.test(html)) return html;
      await page.waitForTimeout(2500);
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
