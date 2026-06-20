// Diagnose: footyaccumulators – wo (falls überhaupt) stecken Quoten im JSON?
import { fetchHtml } from '../lib/fetch.mjs';

const html = await fetchHtml('https://footyaccumulators.com/football-tips/bet-of-the-day');
const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!raw) { console.log('kein __NEXT_DATA__ gefunden'); process.exit(0); }

const re = /"(\w*(?:odd|price|decimal|fractional)\w*)"\s*:\s*("?[0-9.\/]+"?)/gi;
const hits = [...raw.matchAll(re)];
console.log('Quoten-Felder im JSON:', [...new Set(hits.map((h) => `${h[1]}=${h[2]}`))].slice(0, 40).join('  ') || 'KEINE');

const j = JSON.parse(raw);
const w = (j?.props?.pageProps?.page?.meta?.widgets || []).find((x) => x.component === 'Tipster');
const tip = w?.data?.tips?.[0];
console.log('tip keys     :', Object.keys(tip || {}).join(','));
console.log('tip.meta keys:', Object.keys(tip?.meta || {}).join(','));
const g = tip?.meta?.grid?.[0];
console.log('grid keys    :', Object.keys(g || {}).join(','));
console.log('grid.selection:', JSON.stringify(g?.selection));
console.log('grid.match keys:', Object.keys(g?.match || {}).join(','));
// Wo sitzen die oddsDecimal-Werte? Kontext der ersten Fundstelle dumpen.
console.log('typeof bookmakers:', typeof tip?.meta?.bookmakers, Array.isArray(tip?.meta?.bookmakers) ? 'array' : '');
console.log('bookmakers raw :', JSON.stringify(tip?.meta?.bookmakers)?.slice(0, 300));
console.log('outcomes raw   :', JSON.stringify(tip?.outcomes)?.slice(0, 400));
console.log('offer raw      :', JSON.stringify(tip?.offer)?.slice(0, 300));
const oi = raw.indexOf('oddsDecimal');
if (oi >= 0) console.log('oddsDecimal-Kontext:', raw.slice(oi - 120, oi + 60));
