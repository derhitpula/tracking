// Adapter: footyaccumulators.com – Bet of the Day
// Tipps stecken im SSR-eingebetteten __NEXT_DATA__ JSON – kein Browser nötig.
// Pfad: widgets[component='Tipster'].data.tips[].meta.grid[]
//   grid.match.team_a_name / team_b_name / date_iso
//   grid.selection.name  (z. B. "USA / over 2.5 goals")
//   grid.selection.type  (home | away | draw)
export default {
  id: 'footyaccumulators',
  name: 'Footy Accumulators – Bet of the Day',
  url: 'https://footyaccumulators.com/football-tips/bet-of-the-day',
  parse(html) {
    const tips = [];
    try {
      const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
      if (!raw) return tips;
      const j = JSON.parse(raw);
      const widgets = j?.props?.pageProps?.page?.meta?.widgets || [];
      const tipster = widgets.find((w) => w.component === 'Tipster');
      for (const tip of (tipster?.data?.tips || [])) {
        for (const g of (tip?.meta?.grid || [])) {
          const m = g.match;
          if (!m || m.sportType !== 'football') continue;
          const home = m.team_a_name?.trim();
          const away = m.team_b_name?.trim();
          if (!home || !away) continue;
          const kickoff   = m.date_iso || null;
          const match_date = kickoff ? kickoff.slice(0, 10) : new Date().toISOString().slice(0, 10);
          // headline = vollständiger Tipp ("Germany Win & Over 2.5"); name ist
          // abgekürzt ("Germany & Over"). Quote liefert die Seite nicht.
          const market_raw = g.selection?.headline || g.market?.name || g.selection?.name || '';
          tips.push({ home, away, market_raw, match_date, kickoff, odds: null });
        }
      }
    } catch { /* JSON-Fehler ignorieren */ }
    return tips;
  },
};
