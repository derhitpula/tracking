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
// Bookmaker-Struktur des ersten Tipps
console.log('bestOdds     :', JSON.stringify(tip?.meta?.bestOdds));
console.log('bookmakers[0]:', JSON.stringify(tip?.meta?.bookmakers?.[0]));
console.log('bookmakers[1]:', JSON.stringify(tip?.meta?.bookmakers?.[1]));
console.log('selectedBM   :', JSON.stringify(tip?.meta?.selectedBookmakers));
