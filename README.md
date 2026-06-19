# Multi-Source Tipp-Tracker

Sammelt tägliche Fußball-Tipps von mehreren Seiten in **eine** gemeinsame SQLite-DB
und wertet sie aus (Trefferquote, ROI – je Quelle und je Markt). Reines Node.js,
**keine externen Pakete** (nutzt `node:sqlite`, `fetch`/`curl`). Getestet mit Node 24.

> Das ältere Einzeltool `betmines.mjs` (nur BetMines, mit eigener `data/betmines.db`)
> bleibt funktionsfähig. Das neue, übergreifende Tool ist **`track.mjs`**.

## Befehle

```bash
node track.mjs collect [quelle]   # Tipps sammeln (alle Quellen oder nur eine)
node track.mjs results            # offene Tipps: Endstände holen & auswerten
node track.mjs update [quelle]    # collect + results
node track.mjs report             # Auswertung mit Quellen-/Markt-Vergleich
node track.mjs list [--source x] [--date YYYY-MM-DD] [--pending]
node track.mjs sources            # verfügbare Quellen anzeigen
```

Daten: `data/tips.db`. Ergebnis-Cache: `data/results_cache/`.

## Quellen (Adapter)

| Quelle | Status |
|--------|--------|
| betmines | ✅ inkl. Ergebnis über persistente Match-Seiten |
| footballsupertips | ✅ |
| footballpredictions_com | ✅ |
| bettingtips4you | ✅ |
| thatsagoal | ✅ |
| protipster | ✅ |
| freetips | ✅ |
| footballtips | ✅ |
| footballpredictions_net (DE) | ✅ Sammeln; Ergebnis-Matching bei dt. Teamnamen v. a. für Nationen |
| footyaccumulators | ⚠️ Tipps client-seitig gerendert → aktuell 0 (TODO) |
| soccervista | ⚠️ Index-/JS-Seite → aktuell 0 (TODO) |

Jeder Adapter liegt unter `adapters/<id>.mjs` und exportiert `{ id, name, url, parse(html) }`
(BetMines zusätzlich `resolveResult`). Offline gegen ein Fixture testen:
`node test/run.mjs <adapter> <fixtureDatei>` (Fixtures in `test/fixtures/`).

## Ergebnisse / Auswertung

- **BetMines**: Endstand über die eigene Match-Seite (`predictions-..._<fixtureId>`).
- **Alle anderen**: unabhängige Ergebnis-API, gematcht per Teamname + Datum mit
  Fuzzy-Vergleich (`lib/results.mjs`):
  - **API-Football** als Hauptquelle – breite Abdeckung inkl. unterer Ligen.
    Key setzen: Umgebungsvariable `APIFOOTBALL_KEY` (kostenlos, ~100 Anfragen/Tag).
  - **TheSportsDB** (keyless) als Fallback. Achtung: freie Abdeckung ist **dünn**
    – für verlässliche Auswertung den API-Football-Key setzen.
- Märkte werden normalisiert (`lib/markets.mjs`): `O15`/`O25`… = Über X.5 Tore,
  `U…` = Unter, `GG`/`NG` = beide treffen ja/nein, `1`/`X`/`2`/`1X`/`12`/`X2` =
  Ausgang. Englisch **und** Deutsch. Nicht auswertbare/exotische Tipps werden
  gesammelt, aber nicht bewertet (`market = NULL`).

### API-Football-Key setzen (PowerShell)

```powershell
$env:APIFOOTBALL_KEY = "DEIN_KEY"        # für die aktuelle Sitzung
[Environment]::SetEnvironmentVariable("APIFOOTBALL_KEY","DEIN_KEY","User")  # dauerhaft
```

## 🚀 24/7 auf dem VPS (Docker – „1-Click")

Voraussetzung: Docker (`curl -fsSL https://get.docker.com | sh`).

```bash
# Projektordner auf den VPS kopieren (scp/git), dann:
cd marktanal
./install.sh          # fragt den API-Football-Key ab, baut & startet alles
```

Das war's. Der Container läuft dauerhaft (`restart: unless-stopped`, also auch
nach Reboot), sammelt automatisch (Default alle 6 h) und holt Ergebnisse (alle 1 h).

### Privates Dashboard (nur für dich, keine öffentliche URL)

Das Dashboard läuft, ist aber **nur an `127.0.0.1` des VPS** gebunden – also nicht
aus dem Internet erreichbar, keine Domain, kein Caddy. Zugriff per **SSH-Tunnel**:

```bash
# auf deinem lokalen Rechner:
ssh -L 8080:127.0.0.1:8080 user@2.56.98.246
# dann im lokalen Browser öffnen:
#   http://localhost:8080
```

Solange der SSH-Tunnel offen ist, siehst du das Dashboard wie lokal; schließt du
ihn, ist es von außen unsichtbar. (Windows: PuTTY → Connection ▸ SSH ▸ Tunnels,
Source `8080`, Destination `127.0.0.1:8080`.)

Alternativ ganz ohne Browser – direkt im Terminal:
- **Report:** `docker compose exec tracker node track.mjs report`
- **Tipps:** `docker compose exec tracker node track.mjs list`
- **Logs:** `docker compose logs -f`
- **Stoppen / Updaten:** `docker compose down` · `docker compose up -d --build`

Konfiguration über `.env` (aus `.env.example`):
`APIFOOTBALL_KEY`, `ENABLE_DASHBOARD`, `DASHBOARD_PORT`, `TZ`,
`COLLECT_EVERY_HOURS`, `RESULTS_EVERY_HOURS`.
Die Daten liegen im gemounteten Ordner `./data` und bleiben über Updates/Reboots erhalten.

Windows-VPS mit Docker Desktop: `./install.ps1` (PowerShell).

## Automatisch laufen lassen (Windows, ohne Docker)

```powershell
# morgens 09:00 Tipps aller Quellen sammeln
schtasks /create /tn "Tips Collect" /tr "node C:\Users\Paul\marktanal\track.mjs collect" /sc daily /st 09:00
# nachts 01:30 Ergebnisse holen & auswerten
schtasks /create /tn "Tips Results" /tr "node C:\Users\Paul\marktanal\track.mjs results" /sc daily /st 01:30
```

## Architektur

```
track.mjs              CLI + Engine (collect/results/report/list)
lib/db.mjs             SQLite-Schema (tips) + Upsert
lib/fetch.mjs          HTTP (curl-first) + HTML-Helfer
lib/parse.mjs          Quoten-/Team-Parsing
lib/markets.mjs        Markt-Normalisierung (EN/DE) + evalTip
lib/results.mjs        Ergebnis-Engine (API-Football + TheSportsDB, Fuzzy-Match)
adapters/*.mjs         ein Adapter pro Quelle
test/run.mjs           Adapter offline testen
```

## Hinweis

Nur zu Analyse-/Lernzwecken. HTML-Parser können brechen, wenn Seiten ihr Layout
ändern – dann den jeweiligen Adapter anpassen. Bitte die Nutzungsbedingungen der
Seiten beachten. Glücksspiel birgt Risiken.
