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
src/components/       ui.tsx (toasts, Spinner, ErrorBox, Empty, PageHeader, Tabs), Cover, Layout, LoginDialog
src/pages/            Library, Manga, Reader, Updates, Downloads, Browse (Sources + Extensions), Source, Settings
```

## Things to know before changing code
- **Scanlation groups** (latest feature): `Chapter.scanlator` is the group. `MangaPage` shows a group bar when a manga has
  more than one group. The choice is saved per manga in `settings.groups[mangaId] = { group, fill }`.
  `fill` = also show chapters that group never released, taken from other groups (one copy per chapter number,
  preferring the group with the most chapters). Chapters with no scanlator are "Unknown group"; unnumbered chapters
  (`chapterNumber < 0`) are never treated as duplicates. `ReaderPage` uses the same `visibleChapters()` so next/previous
  chapter follows the chosen group, and it always keeps the chapter currently open (`keepId`).
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
No test framework in the repo. Checks were done with Playwright against a live Suwayomi (Local source, generated
paged/webtoon/CBZ series) and by mocking `/api/graphql` with `page.route` for UI-only features (the group bar was
tested that way). Not yet exercised: real extension sources, downloads of remote chapters, UI_LOGIN auth.
Good next step: add Vitest for `src/lib/groups.ts` and a Playwright smoke test to the repo.

## Ideas not built yet
Tracker sync (AniList/MAL), double-page spreads, duplicate finder, source migration, backup/restore UI,
PWA + offline reading of downloaded chapters, a "preferred group" default for the whole library.

## Style
Keep it plain: function components, hooks, no new dependencies unless they clearly earn their place. Prefer small
edits to existing files over new abstractions. Match the existing dark theme and the CSS variables at the top of `styles.css`.
