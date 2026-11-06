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

## Installable app (PWA)
`public/manifest.webmanifest` + `public/sw.js` (registered in `main.tsx`, production only) let Chrome/Edge install Mangadeck (localhost or https only).
The service worker caches only `index.html` for navigations and never touches `/api`. nginx serves `sw.js` and the manifest with `no-cache`.
`open-mangadeck-app.bat` opens a frameless `--app=` window without installing. Bump `SHELL` in `sw.js` if the caching ever changes.

## AniList tracking
`lib/tracker.ts`: AniList's implicit OAuth (user registers a client, pastes its ID in Settings, `authorizeUrl()` sends them to AniList, which returns to `/anilist`
(`AniListCallbackPage`) with `#access_token`; the page strips it from the address at once). Token + client id live in `mangadeck.anilist`, series links in `mangadeck.tracker`;
only the links are in the backup file, never the token. The token goes only to `graphql.anilist.co`. `trackRead(mangaId, chapterNumber)` is called from the reader (chapter finished) and from
`MangaPage`'s mark-read mutation; `pushProgress()` is serialized, reads the current entry and writes only if ahead (`nextEntry()`: never lowers, COMPLETED when the last chapter is reached, a
COMPLETED/REPEATING entry keeps its status). Whole chapters only (`Math.floor`). `TrackerPanel` (series page, only when connected) auto-links an exact title match once, offers Sync now / Change
entry / Stop. The real sign-in cannot be automated (needs the user's AniList account); the push logic was tested against a mocked AniList through CDP `Fetch.fulfillRequest`.
Not built: pulling progress from AniList, MyAnimeList, a retry queue for pushes made while AniList is unreachable (use Sync progress now).

## Offline reading
Three parts. (1) **Last good answers**: `gql()` (`api/client.ts`) stores every successful query in IndexedDB (`lib/offlineDb.ts`, `responses`, key = query text + variables, newest 200 kept);
when the server cannot be reached (fetch fails, or 502/503/504 after retries; no retries when `navigator.onLine` is false) a query returns its stored answer and
`OfflineBar` shows a notice (`OFFLINE_EVENT`). Mutations are never faked. Sign-out clears these (`clearTokens`). (2) **Saved chapters** (`lib/offline.ts`): `saveChapterOffline()` fetches the
page list (`M.fetchPages`) and every page image and puts them in Cache Storage `mangadeck-offline-pages` (key = the page URL), plus a record with the page list in IndexedDB
(`chapters`). `M.fetchPages` falls back to that record when offline. A save job runs one chapter at a time (Layout shows progress, Cancel); chapters the server has not downloaded wait
between each other like paced downloads. `settings.saveAhead` (reader, off by default) quietly saves the next N unread chapters when a chapter opens (`startSaving(..., quiet)`; those records carry `auto: true` and the reader removes them when finished, `removeIfAuto()`, unless `settings.clearReadSaved` is off). The library "Continue reading" shelf opens the next unread chapter in the reader (`firstUnreadChapter`). UI: row button, bulk bar, "Save next 10 unread offline" on `MangaPage`, `/offline` (`OfflinePage`). (3) `public/sw.js` serves the app shell, `/assets/*`,
saved page images (cache `mangadeck-offline-pages`, never deleted by the worker) and covers. Reading progress made offline is queued (`offlineQueue.ts`, `mangadeck.pendingProgress`) by
`M.updateChapter` and sent by `flushProgress()` when the server is back. Limits: only chapters saved first are readable; series and library pages need to have been opened online once; the browser may
evict storage under pressure (we ask for persistent storage when saving). `npm run smoke -- --offline` tests the whole path (save, network off, read).

## Backup and preferred group
`lib/backup.ts` (`BACKUP_KEYS`, `buildBackup/parseBackup/applyBackup`) and Settings, Backup: a JSON file of the browser-side keys (settings incl. groups, links, volumes,
history, merged notes, library view). Never tokens, the server address, caches or unfinished jobs; IndexedDB folder handles cannot be exported. Restore replaces
those keys and reloads. Add a key to `BACKUP_KEYS` when you add a new persisted key that is not a cache.
`settings.defaultGroup` / `defaultFill` give every series a preferred scanlation group; always read a manga's choice through `groupPrefFor()` (its own entry,
including an explicit "All groups" stored as `{ group: null }` while a default is set, else the default). A group a series never had changes nothing.
Settings can list every group across the library (`Q.libraryGroups`, `groupsAcrossLibrary()`, loaded on demand: it reads every chapter) and has a link to `/duplicates`
(`DuplicatesPage`, `lib/duplicates.ts`: `titleKey()` ignores case, accents, punctuation, bracketed notes and a leading "The"; only equal keys match, so sequels stay apart; Remove only
sets `inLibrary` false, downloads stay).

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

Architecture diagram: `docs/architecture.drawio` (3 pages: overview, volumes and rules, downloads / exports / merge). When a feature changes how the
parts connect, update it; it is plain mxfile XML and can be edited in diagrams.net.

## Things to know before changing code
- **Scanlation groups** (latest feature): `Chapter.scanlator` is the group. `MangaPage` shows a group bar when a manga has
  more than one group. The choice is saved per manga in `settings.groups[mangaId] = { group, fill }`.
  `fill` = also show chapters that group never released, taken from other groups (one copy per chapter number,
  preferring the group with the most chapters). Chapters with no scanlator are "Unknown group"; unnumbered chapters
  (`chapterNumber < 0`) are never treated as duplicates. `ReaderPage` uses the same `visibleChapters()` so next/previous
  chapter follows the chosen group, and it always keeps the chapter currently open (`keepId`).
  **Exports and groups**: `.cbz` exports (`packable` in `MangaPage`) follow the chosen group and "fill gaps" like the reader (`visibleChapters`), then
  linked-source gap chapters are added. `oneCopyEach()` (used by `seriesChapters` / `volumeChapters`) keeps one copy per chapter number from the biggest
  group; unnumbered chapters match by name, the nth with that name in its group against the nth in the others (so an extra released by three groups
  counts once, two different extras of one group both stay). **Download unread / Download all** with several groups and no group chosen asks first
  (`pickCopies`): OK downloads one copy of each chapter, Cancel stops so a group can be picked. (Select chapters by hand to download every copy.)
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
  **The volume "database"**: a found, entered or imported volume map is saved in two places (`volumeStore.ts`): this browser
  (`settings.volumes`) and the Suwayomi server, as manga meta under the key `mangadeck.volumes` (`setMangaMeta` /
  `deleteMangaMeta`). The server copy follows the manga to every browser and address (5173 and 8080) and survives Docker
  rebuilds. On opening a manga the newest copy (`savedAt`) wins: pull when the browser has none, push when the server has
  none. Always save through `saveVolumes()`, not `setVolumeInfo()` directly (that one is only for pulling).
  **Server size limit**: Suwayomi silently refuses (mutation returns `null`, no error, nothing stored) a manga meta value over
  4,096 characters. `serverCopy()` keeps the copy under `META_LIMIT` (4,000) by dropping chapter titles first (and setting
  `slim: true`), then release dates and ISBNs; the ranges are always kept. A browser that pulls a slim Wikipedia copy marks it
  `v: 1` so the page re-reads the full details once. Do not add big fields to `VolumeInfo` without checking this.
  Saving from the Edit volumes dialog keeps the dates, ISBNs and titles of volumes that are still in the list
  (`keepExtras()`), and saving without a change does nothing (`sameRanges()`).
  **Rules** (`volumeRules.ts` reading `src/data/volumeRules.json`): the volume lists worked out by hand, shared with every
  user of the app through git. A rule is checked before Wikipedia by `Find volumes` (`source: 'rule'`), and `takeRule()`
  also applies it by itself the first time a series is opened (remembered in `mangadeck.rulesApplied`, so pressing Remove
  sticks).
  **Sharing volume history: before every commit or push, run `npm run volumes:export`** (Suwayomi must be running; it uses
  `SUWAYOMI_URL`, default `http://localhost:4567`; add `-- --dry` to preview) and include `src/data/volumeRules.json`. The
  script (`scripts/export-volume-rules.mjs`, logic in `scripts/volumeRulesExport.mjs`) reads every manga's saved volume map
  from the server and copies the hand-made ones (`source: 'manual'`, i.e. typed or wiki-imported) into the JSON: new series
  become rules, a known title gets its ranges replaced when they changed, an identical list adds the title as another name.
  Lists read from Wikipedia are left out (every app finds those itself). Only titles and chapter ranges are stored, nothing
  personal.
  **Fandom as an automatic source** (`src/lib/fandom.ts`, `lookupVolumesEverywhere()` is what Find volumes / Check for new volumes call):
  when Wikipedia has no list, `lookupFandom()` guesses the series' wiki (`<slug>.fandom.com`, `wikiSlugs()` from the title, its variants and
  the names AniList has for it, `aniListNames()`), checks the wiki's own site name against the title (`isWikiFor()`, so `gto` is not taken for
  any wiki), finds list pages (wiki search, then Volumes / Chapters / Chapters and Volumes / Volumes and Chapters / Chapter List / ...), and
  reads each with `importVolumesFromWiki()` (tables, "Volume N" pages, or text). A result is kept only if `plausibleRanges()` (2+ volumes, in
  order, no overlap). Saved with `source: 'fandom'`, handled like `'wikipedia'` (replaced on re-check, not exported by `volumes:export`).
  When the exact guesses and the AniList names find no wiki, `fuzzySlugs()` tries the title with words dropped from the end and with
  -wiki / -webtoon / -manga added; `isWikiFor()` then needs the wiki's name to cover the title, or the title to cover at least 60% of the
  wiki's name (generic words like Manga/Manhwa/Webtoon/Series are ignored), so a franchise wiki is not taken for a spin-off.
  Fandom's cross-wiki search (`www.fandom.com/api/v1/Search/CrossWiki`) answers 403, so the address has to be guessed. Known misses: wikis
  whose volume page is a stub or gallery (Solo Leveling, Lookism), wikis with only chapter lists (The Boxer), wikis with no search index (GTO).
  Those still need Edit volumes / the wiki-link import.
  **Tried and rejected** (do not redo): MangaDex (browsers are bot-challenged; through a Vite/nginx relay it works but
  licensed series have few volumes filled in; Solo Leveling had only vol 1), Kitsu (`volumeNumber` is a placeholder:
  every Solo Leveling chapter is volume 1), AniList/MyAnimeList (volume counts only), Amazon/BookWalker (no chapter
  ranges, no free API, bot checks, no CORS), MangaUpdates (`api.mangaupdates.com/v1`: reachable but CORS-blocked, so it
  would need a relay; the series `status` text gives a volume count that lags, e.g. Dandadan "26 Volumes" vs 28 on
  Wikipedia; release records rarely carry a volume, and where they do the numbers mix seasons, editions and spin-offs:
  Solo Leveling shows "v1 c110"). As an *update* signal it was never ahead of the sources: across 14 library titles its
  `latest_chapter` was equal or behind (Dandadan/Chainsaw Man/Mob Psycho/Kagurabachi equal, Gachiakuta 86 vs 173), and
  3 of 14 title searches landed on the wrong entry (a doujinshi, a novel, a different "Overgeared"). Releases cannot be asked
  for by series id (`stype: "series"` returns 0), only by title text (100 per page, mixed spin-offs), and their volume
  numbers do not form real volumes: Kaiju No. 8 gives overlapping ranges (1: ch 0–10, 2: ch 5–13, real 1–7 and 8–17), Solo
  Leveling gives 1: 0–130 and 2: 111–152, Dandadan/Gachiakuta/Spy x Family have none. Do not use it as a volume fallback;
  at most it gives a volume count. Manhwa are the usual gap: their Wikipedia articles ("The Boxer (manhwa)", "Lookism (manhwa)",
  "Noblesse (manhwa)", also Solo Leveling) have volume tables with dates and ISBNs but empty chapter lists, so no automatic
  source has their chapter ranges; trying "(manhwa)" article names finds the tables but never any ranges (tested, not worth
  the extra requests). Use Edit volumes or the wiki-link import. **MangaBaka** (`api.mangabaka.org`, OpenAPI at
  `mangabaka.org/api.json`, CORS is open so no relay is needed): the most promising one. `GET /v1/series/search?q=` gives
  `final_volume` and `total_chapters`, and `GET /v1/series/{id}/works?page=N` (default page size; `limit=100` returns
  nothing) lists the books with release date and ISBN. Each work has `inc_chapters` and `part_of_volume`, which would be
  the chapter-to-volume map, but they were empty on all ~600 books checked across 18 series (The Boxer, Solo Leveling,
  Gachiakuta, One Piece, Berserk, Frieren …). Worth re-checking later: users can submit data there. Meanwhile it could
  supply a volume count plus per-volume dates and ISBNs (The Boxer: 13 volumes, more than Wikipedia's 11). Anime-Planet (no public API; a manga page is plain HTML that a server-side request can
  fetch, but it only shows a volume/chapter count, with no per-volume contents; scraping it would also need a relay).
- **AniList rating and reviews** (`src/lib/rating.ts`, `components/RatingPanel.tsx`, collapsed line on the manga page): one AniList search by title
  (only the title is sent), `pickMatch()` accepts a result only when one of its names equals the title after `normTitle()` (a plain search
  returned a wrong 1k-reader entry for "Kaiju No. 8"; novels are skipped, most-read wins), so a series with no exact name shows nothing.
  Shows the average score, readers, favourites and the top 3 reviews as AniList's one-line summaries with a link to the full review
  (full review text is not copied). Cached in `mangadeck.ratings` (7 days, 1 day for "no match"). Not wired into library sort/filter yet.
- **Community volume lists** (Share): a hand-made list shows a **Share** link on the manga page (`ShareDialog`, `volumeShare.ts`
  validates and formats it: title and chapter ranges only). **Send** inserts it into a Supabase table `volume_submissions`
  (`supabase/schema.sql`, project `pguaxzoqhdsujwtmiios`); Copy and Download are the fallback. Row-level security: anon can
  insert only `approved = false` rows and read only approved ones, so the publishable key in `src/lib/community.ts` is safe to
  ship. Never put the secret/service_role key in the repo. The maintainer approves rows in the Supabase dashboard (tick
  `approved`). `remoteRules.ts` fetches approved rows once a day (cached in `mangadeck.remoteRules`, strict `parseRules()`
  validation, fails quietly) and `findVolumeRule` checks them before the built-in rules. `npm run volumes:import` (`-- --dry`
  to preview) copies approved rows into `volumeRules.json` so git keeps them; run it with `volumes:export` before committing.
  Free tier: 500 MB, project pauses after ~1 week idle (Send then fails with a message; built-in rules are unaffected).
- **Other sources** (linked sources): Suwayomi ties a manga entry to one source, so the same series on another source is a
  separate entry. `LinkedSources` (an "Other sources" panel on the manga page) searches the English sources and links entries
  (`settings.links[mangaId] = [{ mangaId, title, source }]`, per browser). Chapters match by chapter number (`sourceLinks.ts`:
  `missingFromLinked`, `findAltChapter`, `withLinkedChapters`; unnumbered chapters never match). Linked chapters: (1) "Download N
  missing" starts a paced job on the linked entry; (2) `.cbz` volume/series/each-volume packing uses `packable`, the main chapters
  plus what linked sources add; (3) `pacer.ts` `tryLinkedSources()` runs when a chapter fails 3 times in a row, downloads the same
  chapter number from a linked source and logs it in the history as "from <source>"; (4) **Move here** (`migrate.ts`) makes a linked
  entry the main one: joins the library in the same categories, marks chapters up to the furthest one read as read, carries
  bookmarks, copies volumes and reader options, removes the old entry from the library (downloads kept) and keeps it linked as a
  fallback. Linking calls `refreshManga` on the other entry so its chapter list exists.
- **Download history**: `history.ts` keeps a log of finished and failed downloads in `mangadeck.history` (newest first, capped at
  500, per browser; Suwayomi itself only knows its current queue). `logDownload()` is called from `pacer.ts` (one entry per
  paced chapter, plus one when a chapter fails 3 times in a row) and from the `.cbz` exports in `MangaPage` (volume, whole
  series, each-volume; failures too). Shown by `HistoryList` at the bottom of the Downloads page.
- **Downloads are paced**: bulk actions use `startPacedJob()` (one chapter at a time, wait from Settings, backoff, auto-pause
  after 3 failures). The runner lives in `pacer.ts`, starts from `Layout`, and holds a Web Lock so only one tab runs it.
  Suwayomi itself has no delay setting. `PacedJobs` has a "Show queue" toggle listing the chapters still waiting (names from
  `Q.chapters`); a paused-after-failure job marks `queue[0]` as failed and Resume retries it; `removeFromJob()` drops one.
- **`.cbz` export jobs** (`src/lib/exportJobs.ts`, UI `components/ExportJobs.tsx` on the Downloads page): `MangaPage.pack(volume)`
  (volume 0 = whole series) only asks for the save location (file picker must come from the click), then calls `startExportJob()`.
  The runner (`startExporter()` from `Layout`, Web Lock `mangadeck-exporter`) has two phases: `downloading` (`downloadOne()` per
  missing chapter with `waitMs` pacing and backoff; a chapter failing 3 times is moved to `job.parked` and the job carries on;
  before a chapter is parked (3rd failure) `tryLinkedSources()` (exported from `pacer.ts`) looks for the same chapter number on the manga's
  linked sources; a hit is stored in `job.alt[chapterId] = { id, source }` and `buildCbz` reads that copy (`packId()`), the history entry
  says how many chapters came from other sources (`altNote()`);
  when `todo` is empty the parked ones get one more pass after a 5 min cool-down (`round` 1 to 2); if some still fail the job
  pauses (`needsDecision()`): Retry (`resumeExport`) or `packWithoutParked` which drops them from `items` and records `leftOut`)
  then `packing` (`buildCbz` streamed to the saved file handle). Always ONE output file, never parts. Jobs persist in `mangadeck.exportjobs`. File handles live in memory only, so after a reload a
  job at the packing phase pauses with `needsFile` and the card shows "Choose file" (`chooseExportFile`). A pack failure
  pauses the job (it does NOT log a history failure; the job is the record); success logs one history entry.
  `buildCbz` retries `fetchPages` and every image fetch 4 times (`withRetry` in `export.ts`). `packEachVolume` (folder of
  volumes) starts one export job per volume (last volume first, since new jobs go on top and the runner takes the top running job), each with a lazy handle that creates its file in the picked folder only when packed; files already there are skipped. Finished exports notify when the tab is hidden (permission asked on start). Not yet tested end to end on a real series;
  known gaps: a stream cannot resume mid-file. `zip.ts` writes ZIP64 end/central records past 4 GB or 65,535 files (one entry
  inside must still be under 4 GB; `ZipBuilder` takes optional tiny `limits` so tests can exercise ZIP64).
- **Merge .cbz files** (`MergeDialog`, buttons on the Downloads page and the manga page; logic `src/lib/merge.ts`, reader `src/lib/zipRead.ts`):
  the user picks several .cbz files with a plain file input (no handles needed), they are sorted by volume (ComicInfo `<Volume>`/`<Number>`,
  else "Vol. 03" in the file name), can be reordered, and `mergeParts()` copies each page's stored bytes into a new zip via
  `ZipBuilder.addRaw()` (no recompression, deflate entries stay deflate; only methods 0 and 8, not encrypted). Pages are renamed
  `001_00001_original.jpg` so every reader sorts them. A new ComicInfo.xml is written (series, Vols. range, writer etc. from the first file that
  has them, PageCount, Notes listing the sources). Sources are only read. `checkParts()` warns (never blocks) about different series,
  duplicate volumes, gaps and files without a volume. Output goes to a save-picker file (Chrome/Edge) or an in-memory blob (warns above
  1.5 GB). Not logged in the history (no manga id). Runs inside the dialog, not as a saved job.
  **Your .cbz files panel** (`LocalFiles`, manga page, Chrome/Edge only): the folder picked for a series is kept per manga in IndexedDB
  (`folderStore.ts`: `saveFolder/loadFolder`, handles survive restarts but need one click, `folderAccess(dir, true)`, to be allowed again).
  "Each volume as .cbz" saves its folder automatically; the panel also has Choose/Change/Forget. It lists the folder's `.cbz` files whose name
  matches the title (`nameMatchesSeries`), reads volumes from names (`volumesInName`: "Vol. 03", "Vols. 1-5"), shows which known volumes are
  missing, and merges the ticked files into the SAME folder (`MergeDialog` with `folder` + `initialFiles`; never overwrites, adds " (2)").
  **Adding new volumes to a complete file**: our page names (`v01_c0003_p004.jpg`, kept at the end of a merged name) tell `pageVolumes()` which
  volumes a file holds (`MergePart.covers`), so a "Complete" or already-merged file sorts by its first volume and the panel's `updateFor()` finds
  the single-volume files it lacks ("New since X: Vol. 27" + **Add to it**, which ticks them together). `mergeParts()` skips any chapter
  (`chapterKeyOf()`, by chapter number, whatever volume) that an earlier file already brought in, so a repeated volume adds nothing. The result
  is a NEW file (`Series - Vols. 1-27.cbz`); the old complete file is never touched or deleted.
  Merged sources are remembered in localStorage `mangadeck.merged` and shown as "merged into X". Only file names are read for the list;
  the zips are opened when merging.
- **Running Mangadeck next to an existing Suwayomi container** (Kamjohn's setup): never plain `docker compose up` (the compose file
  would start a second Suwayomi on 4567). Use `$env:SUWAYOMI_URL='http://host.docker.internal:4567'; docker compose up -d --build --no-deps mangadeck`.
  Suwayomi keeps downloads as `.cbz` per chapter under its downloads folder; deleting through the API
  (`deleteDownloadedChapters`) may leave the files, so check the folder too. Library cover badges: orange = unread, blue = downloaded.
- **Library shelves** (`LibraryPage`): "What's popular" (`fetchPopular()`, AniList trending, minus library titles, novels and adult titles; items carry `rank`
  and an empty `because`) sits above "Recommended for you" (`fetchRecommendations()`). Both use the same card (`recItem`) and the hover peek.
  Titles with new chapters after "Check for updates" get a solid green border and a `fresh-ribbon` (`.card.fresh .card-art`, no animation).
  Clicking a recommendation or popular card opens `/find?q=<title>` (`FindPage`, which is `SourceResults` over every English source), not one source.
  **Sorts**: Title is A to Z; Unread, Last read, Date added and Latest chapter start with most/newest, "Reverse order" flips. Latest chapter uses
  `newestChapterReleased()` (`lib/latest.ts`): the earliest date of the highest whole chapter number, because `latestUploadedChapter` is the max upload
  date, which extras (311.5), re-uploads and other groups' copies push to "today". It needs every title's chapter dates (`Q.chapterDates`, big), so that query runs only while this sort is selected.
- **Dates**: Suwayomi sends `uploadDate` in milliseconds but `fetchedAt` in seconds. Always go through `toMs()` /
  `timeAgo()` / `dayBucket()` in `format.ts`.
- **Descriptions**: some sources (Atsumaru) put `**Rating**:`, `**Year**:`, `**Views**:` and `**Synopsis**:` in the text, and
  later changed to plain `Rating: …` / `Synopsis: …` lines (both forms are read; also Note and Alternative Names, and a
  "(Source: …)" credit is dropped). `parseDescription()` splits them, otherwise the line clamp hides the synopsis behind the facts.
  Manga page layout: title, author · status · source · facts on one muted line, then the description (the main thing, 5 lines,
  "Show more" reveals notes and alternative names), then 5 tag chips, then the buttons.
- **Sources are English only** unless `settings.showAllLanguages` is on (the Local source is always shown). Library
  "+ Sources" search asks English sources six at a time.
- Outside services called from the browser: Wikipedia (volumes) and AniList (recommendations, hover descriptions).
  Never send the bearer token or Suwayomi URLs to them; external cover images use a plain `<img>`, not `useImage`.
- `.hero-bg` (blurred cover) is scaled past the hero; it must keep `pointer-events: none` or it eats clicks on the
  chapter toolbar. Check hover bugs with `document.elementFromPoint` at several heights, not just the center.
- For README screenshots the manga covers are hidden on purpose (public repo); see `docs/screenshots/`. `npm run screenshots` retakes the newer
  ones (downloads page, manga page with volumes and files, merge dialog, library) against `npm run dev` with headless Chrome
  (`scripts/readme-screenshots.mjs`: pretend jobs/history/folder are injected, covers hidden; uses the maintainer's manga ids, `MANGA_ID` overrides).
  Retake them when those screens change, and re-export the diagrams in `docs/images/` when the architecture diagram changes.
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
description parsing. `npm run smoke` (`scripts/smoke.mjs`, headless Chrome over CDP, no dependencies) loads the main pages against the running app and fails on script errors; it only reads (`--reader` opens a chapter and saves a position). UI checks were done by driving the dev server in a browser (Playwright earlier, the
Claude browser pane later) against a live Suwayomi, and by mocking `/api/graphql` with `page.route` for UI-only features.
Not yet exercised: UI_LOGIN auth, and a full-volume `.cbz` opened in a real comic reader.
Good next step: grow the smoke test (reader paging, group bar) or move it to Playwright if it gets complicated.

## Ideas not built yet
MyAnimeList sync, pulling progress from AniList, double-page spreads, source migration, reading chapters offline that were not saved first
(the app is installable and saved chapters read offline).

## Style
Keep it plain: function components, hooks, no new dependencies unless they clearly earn their place. Prefer small
edits to existing files over new abstractions. Match the existing dark theme and the CSS variables at the top of `styles.css`.
