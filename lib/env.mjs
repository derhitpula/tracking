// Mini-.env-Lader (ohne Abhängigkeit). Liest data-fremde .env aus dem Projekt-
// root und setzt fehlende Variablen in process.env. Im Docker-Betrieb sind die
// Variablen bereits gesetzt (env_file) -> dann passiert hier nichts.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^['"]|['"]$/g, ''); // umschließende Quotes weg
    if (process.env[key] === undefined && val !== '') process.env[key] = val;
  }
}
