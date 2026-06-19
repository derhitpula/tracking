// Echter Headless-Browser (Playwright) als letzter Ausweg gegen Cloudflare-
// JS-Challenges – läuft nativ auf Windows (kein Docker/keine Virtualisierung).
// Playwright ist optional: ist es nicht installiert, liefert das hier null und
// der Tracker läuft normal weiter.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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

let _chromium; // gecacht: Modul oder null
async function getChromium() {
  if (_chromium !== undefined) return _chromium;
  try { _chromium = (await import('playwright')).chromium; }
  catch { _chromium = null; }
  return _chromium;
}

export async function fetchViaBrowser(url) {
  const chromium = await getChromium();
  if (!chromium) return null; // Playwright nicht installiert
  const proxy = pwProxy();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 }, ...(proxy ? { proxy } : {}) });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Cloudflare-Challenge braucht ein paar Sekunden, bis sie sich auflöst
    for (let i = 0; i < 8; i++) {
      const html = await page.content();
      if (!CF_MARK.test(html)) return html;
      await page.waitForTimeout(2500);
    }
    return await page.content();
  } finally { await browser.close().catch(() => {}); }
}
