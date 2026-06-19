// HTTP-Helfer: native fetch, sonst curl-Fallback (umgeht TLS-/Bot-Filter).
import { execFileSync } from 'node:child_process';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function fetchHtml(url) {
  // curl zuerst: zuverlässiger gegen Bot-/TLS-Filter als Nodes native fetch
  try {
    const txt = execFileSync('curl', ['-s', '-L', '-A', UA, '-H', 'Accept: text/html',
      '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (txt && txt.length > 500) return txt;
  } catch { /* fetch-Fallback */ }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Kleine Helfer fürs HTML-Parsing ohne externe Libs
export const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&#x?[0-9a-f]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
