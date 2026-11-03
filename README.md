# Mangadeck

A faster, denser replacement UI for [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server).
It keeps the Suwayomi server (and its whole Mihon/Tachiyomi extension ecosystem) and replaces only the
interface, talking to the server's GraphQL API at `/api/graphql`.

React + TypeScript + Vite, no UI framework, no GraphQL codegen. About 3k lines.

## Run it

### Docker (recommended)

```bash
docker compose up -d --build
# open http://localhost:8080
```

The compose file starts Suwayomi and Mangadeck together. nginx serves the UI and proxies `/api` to Suwayomi,
so there is no CORS and nothing to configure. Data lives in `./suwayomi-data`.

Already have a Suwayomi running? Delete the `suwayomi` service from `docker-compose.yml` and start with:

```bash
SUWAYOMI_URL=http://192.168.1.50:4567 docker compose up -d --build
```

### Dev

```bash
npm install
echo "SUWAYOMI_URL=http://localhost:4567" > .env.local   # where your server is
npm run dev                                              # http://localhost:5173
```

`/api` is proxied by Vite, so the browser stays same-origin.

### Auth

- **No auth / BASIC_AUTH / SIMPLE_LOGIN**: works through the browser (cookies and basic auth ride along on the same origin).
- **UI_LOGIN (JWT)**: a sign-in dialog appears automatically on a 401; tokens refresh on their own. Page images are
  fetched with the bearer token and shown from blob URLs.

## Tested

Run end to end in headless Chrome against a live **Suwayomi-Server v2.4.2366** (Local source with generated paged,
webtoon and CBZ series): library, categories, search/sort/filter, chapter selection, paged and webtoon readers,
resume and progress saving, mark-read on finish, updates, history, browse and mobile layout. Not yet exercised:
real extension sources, downloads of remote chapters, and UI_LOGIN auth.

## What's in it

| Area | Features |
| --- | --- |
| Library | Category tabs with counts, search, sort (title, unread, last read, date added, latest chapter) with direction, unread/downloaded filters, cover size slider, unread/download badges, "Continue reading" shelf, multi-select (add to category, remove), one-click "Check for updates" with progress |
| Manga page | Scanlation group bar (filter by group, "fill gaps from other groups", download all/unread per group; reader next/prev follows it), smart Continue/Start/Read-again button, categories, refresh, chapter filters (unread, downloaded, bookmarked), sort, shift-click range select, bulk mark read/unread, bookmark, download, delete downloads, download all unread, per-manga reader settings |
| Reader | Paged (LTR/RTL) and webtoon modes, 4 fit modes, tap zones, swipe, keyboard, preloading, progress slider, resume position, auto mark-read, auto-download upcoming chapters, fullscreen |
| Updates | New chapters grouped by day, reading history, one-tap download |
| Downloads | Live queue with progress, start/pause, clear, remove |
| Browse | Sources by language, popular/latest/search with load-more, extension install/update/uninstall, refresh repository |

Reader keys: `←/→` pages (direction-aware), `Space`/`Shift+Space`, `[` `]` chapters, `M` toggle menu, `F` fullscreen, `Esc` back.

## Layout

```
src/api/client.ts     GraphQL client, auth, token refresh
src/api/queries.ts    every query/mutation + types (single file, easy to extend)
src/lib/settings.ts   persisted reader/library prefs (localStorage), per-manga overrides
src/lib/useImage.ts   image loading with optional bearer auth + preloading
src/pages/*           Library, Manga, Reader, Updates, Downloads, Browse, Source, Settings
src/styles.css        the whole design, driven by CSS variables at the top
```

## Notes

- The GraphQL shapes were taken from the official Suwayomi-WebUI source (current `master`). If a future server
  release renames a field, `src/api/queries.ts` is the only file to touch.
- Download progress and library updates are polled (2–5 s) rather than using GraphQL subscriptions.
- The stock WebUI keeps running inside Suwayomi; Mangadeck ignores it. Mangadeck is just another client of the
  same API, so you can use both side by side.

## Ideas for next steps

Tracker sync (AniList/MAL), double-page spreads, library duplicate finder, source migration, backup/restore UI,
PWA install + offline reading from downloaded chapters.
