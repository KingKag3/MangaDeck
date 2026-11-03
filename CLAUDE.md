# Mangadeck: notes for Claude Code

Mangadeck is a replacement web UI for **Suwayomi-Server** (self-hosted manga server, Mihon/Tachiyomi extensions).
The Suwayomi server stays as is; this app is another client of its GraphQL API. Owner: Kamjohn. He prefers to
delegate design decisions and get finished, working changes rather than step-by-step guidance.

## Stack
React 18 + TypeScript + Vite 5, react-router-dom 6, TanStack Query 5. No UI framework, no GraphQL codegen
(queries are hand-written strings sent with `fetch`). Styling is one file, `src/styles.css`, driven by CSS variables.
Settings live in `localStorage` (`mangadeck.settings`, server override in `mangadeck.server`).

## Run
- Docker (how Kamjohn runs it, on Windows): `start-mangadeck.bat` = `docker compose up -d --build`, then open
  http://localhost:8080. Mangadeck (nginx, port 8080) and `ghcr.io/suwayomi/tachidesk:stable` (port 4567) run together.
  Suwayomi data is in `./suwayomi-data` (not in git). nginx proxies `/api` to Suwayomi, so there is no CORS.
- Live reload while developing: `dev-mangadeck.bat` (starts only Suwayomi in Docker, then `npm run dev` on 5173).
- Dev: `npm install`, put `SUWAYOMI_URL=http://localhost:4567` in `.env.local`, `npm run dev` (port 5173, Vite proxies `/api`).
- The Docker image serves a **built** copy. Source edits do nothing until `docker compose up -d --build` is re-run.
- Check before finishing: `npx tsc --noEmit && npm run build`.

## Layout
```
src/api/client.ts     gql() fetch client, UI_LOGIN JWT + refresh, fetchBlob() for authed images
src/api/queries.ts    ALL queries/mutations (Q.*, M.*) and types. Change API shapes only here.
src/lib/settings.ts   persisted prefs: reader, library, perManga reader overrides, groups (scanlation choice per manga)
src/lib/groups.ts     scanlator grouping: listGroups(), visibleChapters(all, pref, keepId)
src/lib/useImage.ts   image loading with optional bearer auth, preloading
src/lib/volumes.ts    official volumes: lookupVolumes() (Wikipedia), parseVolumeRanges(), volumeOf(), summarizeVolumes(), volumeChapters(), seriesChapters(); PARSER_VERSION
src/lib/export.ts     buildCbz() (pages + ComicInfo.xml), queueAndWait(), pickSaveFile() (File System Access API)
src/lib/zip.ts        ZipBuilder: stored zip, optional sink to stream to disk, no ZIP64 (4 GB / 65k files guard)
src/lib/pacer.ts      paced bulk downloads: waitMs/backoffMs, downloadOne(), saved jobs, startPacer() (runs from Layout)
src/lib/recommend.ts  AniList recommendations (fetchRecommendations, pickSeeds)
src/lib/search.ts     queryWords(), titleHasWords() used by library and source search
src/components/       ui.tsx (toasts, Spinner, ErrorBox, Empty, PageHeader, Tabs, Shelf with arrows), Cover, Layout, LoginDialog,
                      SourceResults (library "+ Sources" search), PacedJobs (Downloads page), RecDialog (+ RecPeek hover card)
src/pages/            Library, Manga, Reader, Updates, Downloads, Browse (Sources + Extensions), Source, Settings
```

## Things to know before changing code
- **Scanlation groups** (latest feature): `Chapter.scanlator` is the group. `MangaPage` shows a group bar when a manga has
  more than one group. The choice is saved per manga in `settings.groups[mangaId] = { group, fill }`.
  `fill` = also show chapters that group never released, taken from other groups (one copy per chapter number,
  preferring the group with the most chapters). Chapters with no scanlator are "Unknown group"; unnumbered chapters
  (`chapterNumber < 0`) are never treated as duplicates. `ReaderPage` uses the same `visibleChapters()` so next/previous
  chapter follows the chosen group, and it always keeps the chapter currently open (`keepId`).
- **Volumes**: Suwayomi has no volume data. `lookupVolumes()` reads Wikipedia "List of X chapters/volumes" pages. Pages come
  in several styles (numbered lists, `#` lists, "* Chapter: 18–26" bullets) and can hold several series (light novels,
  the manga, spin-offs), each a run of volumes that restarts at 1. `parseVolumeRanges(wikitext, title)` reads every run and
  picks one: runs whose chapters keep counting up (light novel chapters restart each volume, so they lose), the run under
  the heading that matches the title, then the longest. Empty (unreleased) volumes are skipped. When the parser learns
  something new, bump `PARSER_VERSION`: saved lookups from older versions are redone once when the manga is opened.
  Results are saved per manga in `settings.volumes`.
  Also handled: sources add subtitles Wikipedia does not ("Mushoku Tensei - Jobless Reincarnation"), so `titleVariants()`
  tries shorter names (exact "List of X chapters/volumes" pages only); chapter words other than "Chapter" ("Mission: 1–5"),
  and only bullets that start with the chapter word count ("*Short Mission: 14" / "*Extra Mission" do not).
  When there is no automatic source, the manga page offers **Set volumes** (`VolumeDialog`): type `1: 0-12` lines,
  paste a volume list, or **import from a wiki link** (`wikiImport.ts`: a Wikipedia list page, or one volume page of a
  Fandom wiki such as `…/wiki/Manga_Volume_1`, which follows Volume 2, 3, … and reads each "Chapters" section).
  Hand-entered volumes (`source: 'manual'`) are never replaced by a lookup.
  **Tried and rejected** (do not redo): MangaDex (browsers are bot-challenged; through a Vite/nginx relay it works but
  licensed series have few volumes filled in; Solo Leveling had only vol 1), Kitsu (`volumeNumber` is a placeholder:
  every Solo Leveling chapter is volume 1), AniList/MyAnimeList (volume counts only), Amazon/BookWalker (no chapter
  ranges, no free API, bot checks, no CORS).
- **Downloads are paced**: bulk actions use `startPacedJob()` (one chapter at a time, wait from Settings, backoff, auto-pause
  after 3 failures). The runner lives in `pacer.ts`, starts from `Layout`, and holds a Web Lock so only one tab runs it.
  `.cbz` exports use `queueAndWait()` with the same pacing. Suwayomi itself has no delay setting.
- **Dates**: Suwayomi sends `uploadDate` in milliseconds but `fetchedAt` in seconds. Always go through `toMs()` /
  `timeAgo()` / `dayBucket()` in `format.ts`.
- **Descriptions**: some sources (Atsumaru) put `**Rating**:`, `**Year**:`, `**Views**:` and `**Synopsis**:` in the text.
  `parseDescription()` splits them, otherwise the line clamp hides the synopsis behind the facts.
- **Sources are English only** unless `settings.showAllLanguages` is on (the Local source is always shown). Library
  "+ Sources" search asks English sources six at a time.
- Outside services called from the browser: Wikipedia (volumes) and AniList (recommendations, hover descriptions).
  Never send the bearer token or Suwayomi URLs to them; external cover images use a plain `<img>`, not `useImage`.
- `.hero-bg` (blurred cover) is scaled past the hero; it must keep `pointer-events: none` or it eats clicks on the
  chapter toolbar. Check hover bugs with `document.elementFromPoint` at several heights, not just the center.
- For README screenshots the manga covers are hidden on purpose (public repo); see `docs/screenshots/`.
- Chapters are fetched newest first (`order: SOURCE_ORDER DESC`). Reader "next" is `list[idx - 1]`, "previous" is `list[idx + 1]`.
- History uses `filter: { lastReadAt: { greaterThan: "0" } }`. `condition: { isRead: true }` is wrong for it.
- `startDownloader` with an empty queue makes the server hang about 30 s, so the Start button is disabled when the queue is empty.
- ReaderPage keyboard handler ignores keys from SELECT/TEXTAREA/non-range INPUT. The progress slider must keep working
  with arrow keys, and it blurs on pointer-up so paging keys work again.
- Webtoon lazy loading window: `i >= current - 3 && i <= current + preload + 3`.
- Mobile layout: bottom nav under ~768 px. Keep new toolbars wrappable (`flex-wrap`, `min-width: 0`).
- GraphQL shapes follow the official Suwayomi-WebUI `master`. Verified against Suwayomi-Server **v2.4.2366**.
- Extensions: none are installed by default. Kamjohn adds a repo under Suwayomi's extension repositories
  (config key `server.extensionStores`), e.g. the Keiyoushi repo `https://github.com/keiyoushi/extensions/raw/repo/index.pb`
  (`.pb` is Protocol Buffers; Suwayomi parses it, nobody reads it by hand).

## Testing approach used so far
Vitest (`npm test`) covers the pure helpers: groups, volumes parser/mapping, zip writer, ComicInfo, pacing maths, search, dates and
description parsing. No UI tests in the repo. UI checks were done by driving the dev server in a browser (Playwright earlier, the
Claude browser pane later) against a live Suwayomi, and by mocking `/api/graphql` with `page.route` for UI-only features.
Not yet exercised: UI_LOGIN auth, and a full-volume `.cbz` opened in a real comic reader.
Good next step: a Playwright smoke test in the repo.

## Ideas not built yet
Tracker sync (AniList/MAL), double-page spreads, duplicate finder, source migration, backup/restore UI,
PWA + offline reading of downloaded chapters, a "preferred group" default for the whole library.

## Style
Keep it plain: function components, hooks, no new dependencies unless they clearly earn their place. Prefer small
edits to existing files over new abstractions. Match the existing dark theme and the CSS variables at the top of `styles.css`.
