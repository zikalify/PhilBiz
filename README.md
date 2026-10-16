# PHILBIZ — Philippine Business News Wire

A spartan, Drudge Report-style aggregator of **free-to-read** Philippine
business news. Pure HTML / CSS / JS — no build step.

## Files

- `index.html`      – market page shell
- `styles.css`     – spartan look + responsive columns
- `app.js`         – fetches live headlines from free sources, filters paywalled
  outlets, dedupes, renders, auto-refreshes every 8 min
- `refresh.mjs`    – regenerates `data/snapshot.js` for offline / `file://` use
- `data/snapshot.js` – last-good wire (loaded before app.js so it shows instantly)

## Sources

GMA News Online (Money), Rappler Business, The Manila Times Business,
Interaksyon Business, Bilyonaryo, FinTech News Philippines.

Paywalled outlets (BusinessWorld, Business Inquirer, Philippine Star, Manila
Bulletin) are **excluded** — only free-to-read articles are linked.

## Caching

Stories are cached in `localStorage` (`philbiz.cache.v3`) after every successful
fetch, so the next visit shows them instantly — even offline. On refresh,
headlines already cached are kept and only stories that were not present before
are flagged with a red **NEW** badge. On return visits, the wire also shows how
many stories are new since your last visit.

## Running locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. (Don't use `file://` directly — browsers block
the network requests. If you must, run `node refresh.mjs` first so the snapshot
shows.)

## Keep it up to date

```
node refresh.mjs        # writes data/snapshot.js
```

Wire `refresh.mjs` into cron (every 30 min) so `file://` viewers and offline
use always get fresh headlines, e.g.:

```
*/30 * * * * cd /home/paul/Desktop/PhilBiz && node refresh.mjs >> /tmp/philbiz.log 2>&1
```

Live visitors never need this — `app.js` refetches automatically on load and
every 8 minutes, plus on tab focus.
