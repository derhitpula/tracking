// Zeitzonen-Helfer ohne externe Pakete (nutzt Intl/IANA-Datenbank).
// Wandzeit einer Zeitzone <-> UTC, inkl. korrektem Sommer-/Winterzeit-Wechsel.

// Offset (Minuten, TZ minus UTC) einer IANA-Zeitzone zu einem UTC-Zeitpunkt.
function tzOffsetMin(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== 'literal') p[part.type] = part.value;
  const h = p.hour === '24' ? 0 : Number(p.hour);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, h, p.minute, p.second);
  return (asUTC - date.getTime()) / 60000;
}

// Wandzeit (YYYY-MM-DD, HH:MM) in einer IANA-Zeitzone -> UTC-ISO-String.
export function wallToUtcIso(dateStr, timeStr, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  let ts = Date.UTC(y, mo - 1, d, hh, mm);
  // zweimal iterieren, damit DST-Grenzfälle konvergieren
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMin(new Date(ts), timeZone);
    ts = Date.UTC(y, mo - 1, d, hh, mm) - off * 60000;
  }
  return new Date(ts).toISOString();
}

// Heutiges Datum (YYYY-MM-DD) in einer IANA-Zeitzone.
export function todayInTz(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// n Tage zu einem YYYY-MM-DD-Datum addieren (n darf negativ sein).
export function addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}
