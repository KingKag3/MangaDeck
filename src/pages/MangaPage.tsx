import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type Chapter } from '../api/queries';
import { Cover } from '../components/Cover';
import { useImage } from '../lib/useImage';
import { ErrorBox, Spinner, errorToast, toast } from '../components/ui';
import { chapterLabel, parseDescription, timeAgo, titleCase } from '../lib/format';
import { groupOf, groupPrefFor, listGroups, visibleChapters } from '../lib/groups';
import { PARSER_VERSION, keepExtras, mergeNewVolumes, oneCopyEach, sameRanges, seriesChapters, summarizeVolumes, volumeChapters, volumeColor, volumeOf, type VolumeRange } from '../lib/volumes';
import VolumeDialog from '../components/VolumeDialog';
import { lookupVolumesEverywhere } from '../lib/fandom';
import ShareDialog from '../components/ShareDialog';
import MergeDialog from '../components/MergeDialog';
import LocalFiles from '../components/LocalFiles';
import { saveFolder } from '../lib/folderStore';
import LinkedSources from '../components/LinkedSources';
import RatingPanel from '../components/RatingPanel';
import { withLinkedChapters } from '../lib/sourceLinks';
import { markSeen } from '../lib/fresh';
import { tagColor } from '../lib/tagColor';
import { chooseSync, pushVolumeMeta, saveVolumes, takeRule, volumeInfoFromMeta } from '../lib/volumeStore';
import { estimateWaitMs, formatDuration, paceConfig, startPacedJob } from '../lib/pacer';
import { startExportJob, useExportJobs } from '../lib/exportJobs';
import { canPickFolder, canSaveToDisk, fileSizeIn, pickFolder, pickSaveFile, safeFileName, type PackMeta } from '../lib/export';
import {
  effectivePrefs,
  setGroupPref,
  setVolumeInfo,
  updateMangaPrefs,
  useSettings,
  type Direction,
  type Fit,
  type ReaderMode,
} from '../lib/settings';

const TAG_LIMIT = 5;

export default function MangaPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const nav = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();

  // Opening a title clears its "new chapters" highlight in the library.
  useEffect(() => markSeen(id), [id]);

  const manga = useQuery({ queryKey: ['manga', id], queryFn: () => Q.manga(id) });
  const chapters = useQuery({ queryKey: ['chapters', id], queryFn: () => Q.chapters(id) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: Q.categories });

  const backdrop = useImage(manga.data?.thumbnailUrl);
  const [expanded, setExpanded] = useState(false);
  const [allTags, setAllTags] = useState(false);
  const [volFilter, setVolFilter] = useState<number | null>(null);

  // Exports of this series that are running or paused (they live on the Downloads page).
  const exporting = useExportJobs().filter((j) => j.mangaId === id && (j.state === 'running' || j.state === 'paused'));

  /** What goes into ComicInfo.xml for the whole series (volume 0) or one volume. */
  function packMeta(volume: number, ranges: VolumeRange[] | undefined): PackMeta {
    const vr = ranges?.find((r) => r.volume === volume);
    return {
      author: manga.data!.author,
      artist: manga.data!.artist,
      genre: manga.data!.genre,
      summary: manga.data!.description,
      web: manga.data!.realUrl,
      totalVolumes: ranges?.length,
      ...(volume === 0 ? {} : { released: vr?.released, isbn: vr?.isbn }),
      titles: Object.assign({}, ...(ranges ?? []).filter((r) => volume === 0 || r.volume === volume).map((r) => r.titles ?? {})),
    };
  }

  async function pack(volume: number) {
    const ranges = settings.volumes[String(id)]?.ranges;
    const items =
      volume === 0
        ? seriesChapters(packable, ranges)
        : volumeChapters(packable, ranges, volume).map((chapter) => ({ chapter, volume }));
    if (!items.length) return;
    const series = manga.data!.title;
    const suggested = `${safeFileName(series)} - ${volume === 0 ? 'Complete' : `Vol. ${String(volume).padStart(2, '0')}`}.cbz`;
    if (volume === 0 && !canSaveToDisk && !confirm(`This browser can't save straight to disk, so all ${items.length} chapters are built in memory first. That can run out of memory. Continue?`)) return;

    // The file picker has to open straight from the click, before any waiting.
    let handle: Awaited<ReturnType<typeof pickSaveFile>> = null;
    if (canSaveToDisk) {
      try {
        handle = await pickSaveFile(suggested);
      } catch (e) {
        return errorToast(e);
      }
      if (!handle) return;
    }
    // The export runs as a saved job (see lib/exportJobs.ts): it shows on the Downloads page and can be resumed.
    const { existing } = startExportJob({
      mangaId: id,
      title: series,
      volume,
      fileName: suggested,
      items: items.map((i) => ({ id: i.chapter.id, chapterNumber: i.chapter.chapterNumber, volume: i.volume, label: chapterLabel(i.chapter) })),
      todo: items.filter((i) => !i.chapter.isDownloaded).map((i) => i.chapter.id),
      meta: packMeta(volume, ranges),
      handle,
    });
    toast(
      existing
        ? 'This is already being exported. Follow it on the Downloads page.'
        : `Export started: ${items.length} chapters into one .cbz. Follow it on the Downloads page; if it fails you can resume it there.`,
    );
  }

  /** Every volume as its own .cbz, into one folder you pick. Each volume is a saved export job (see lib/exportJobs.ts), so
   *  it shows on the Downloads page and can be resumed. Files already in the folder are skipped. */
  async function packEachVolume() {
    const ranges = settings.volumes[String(id)]?.ranges;
    const list = summarizeVolumes(packable, ranges).map((v) => v.volume);
    if (!list.length) return;
    const series = manga.data!.title;
    if (
      !canPickFolder &&
      !confirm(`This browser can't write into a folder, so each of the ${list.length} files is built in memory and offered as a separate download. Continue?`)
    )
      return;

    // The folder picker has to open straight from the click, before any waiting.
    let dir: Awaited<ReturnType<typeof pickFolder>> = null;
    if (canPickFolder) {
      try {
        dir = await pickFolder();
      } catch (e) {
        return errorToast(e);
      }
      if (!dir) return;
      void saveFolder(id, dir); // remembered, so the "Your .cbz files" panel can list and merge them
      setFolderKey((k) => k + 1);
    }
    let started = 0;
    let skipped = 0;
    // New jobs go to the top of the list and the runner takes the top one first, so start the last volume first.
    for (const volume of [...list].reverse()) {
      const fileName = `${safeFileName(series)} - Vol. ${String(volume).padStart(2, '0')}.cbz`;
      if (dir && (await fileSizeIn(dir, fileName)) > 0) {
        skipped++;
        continue;
      }
      const items = volumeChapters(packable, ranges, volume).map((chapter) => ({ chapter, volume }));
      if (!items.length) continue;
      const folder = dir;
      // The file is only created when its volume is packed, so waiting volumes leave no empty files behind.
      const handle = folder
        ? { name: fileName, createWritable: async () => (await (await folder.getFileHandle(fileName, { create: true })).createWritable()) }
        : null;
      const r = startExportJob({
        mangaId: id,
        title: series,
        volume,
        fileName,
        items: items.map((i) => ({ id: i.chapter.id, chapterNumber: i.chapter.chapterNumber, volume: i.volume, label: chapterLabel(i.chapter) })),
        todo: items.filter((i) => !i.chapter.isDownloaded).map((i) => i.chapter.id),
        meta: packMeta(volume, ranges),
        handle,
      });
      if (!r.existing) started++;
    }
    toast(
      started
        ? `Export started: ${started} volume file${started === 1 ? '' : 's'}${skipped ? `, ${skipped} already in the folder skipped` : ''}. Follow it on the Downloads page; if it fails you can resume it there.`
        : skipped
          ? 'Every volume is already in that folder.'
          : 'Those volumes are already being exported.',
    );
  }

  const findVolumes = useMutation({
    mutationFn: () => lookupVolumesEverywhere(manga.data!.title),
    onSuccess: (info) => {
      if (info) {
        saveVolumes(id, info);
        toast(`Found ${info.ranges.length} volumes ${info.source === 'rule' ? 'in the built-in list' : info.source === 'fandom' ? 'on a Fandom wiki' : 'on Wikipedia'}`);
      } else toast('No chapter-by-volume list found for this title. Use “Set volumes” to enter them by hand.', 'error');
    },
    onError: errorToast,
  });
  // Look again for volumes released since the saved list. A list read from Wikipedia is simply replaced; one from the
  // built-in rules or typed by hand only gets the newer volumes added, so nothing you corrected is lost.
  const checkVolumes = useMutation({
    mutationFn: () => lookupVolumesEverywhere(manga.data!.title, { skipRules: true }),
    onSuccess: (found) => {
      const cur = settings.volumes[String(id)];
      if (!found) return void toast('No volume list found online. Use “Edit volumes” to add the new volume by hand.', 'error');
      if (!cur || cur.source === 'wikipedia' || cur.source === 'fandom') {
        saveVolumes(id, found);
        return void toast(`Updated: ${found.ranges.length} volumes`);
      }
      const { ranges, added } = mergeNewVolumes(cur.ranges, found.ranges);
      if (!added) return void toast('No new volumes found yet');
      saveVolumes(id, { ...cur, ranges });
      toast(`Added ${added} new volume${added === 1 ? '' : 's'}`);
    },
    onError: errorToast,
  });
  const [editVolumes, setEditVolumes] = useState(false);
  const [shareVolumes, setShareVolumes] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [folderKey, setFolderKey] = useState(0);
  const [asc, setAsc] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const [catOpen, setCatOpen] = useState(false);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['manga', id] });
    qc.invalidateQueries({ queryKey: ['chapters', id] });
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['downloads'] });
  };

  const refresh = useMutation({
    mutationFn: () => M.refreshManga(id),
    onSuccess: () => {
      refreshAll();
      toast('Refreshed from source');
    },
    onError: errorToast,
  });

  // First visit to a manga that was never fetched (e.g. from a source browse): pull details + chapters.
  const autoFetched = useRef(false);
  useEffect(() => {
    if (autoFetched.current) return;
    if (manga.data && chapters.data && chapters.data.length === 0) {
      autoFetched.current = true;
      refresh.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manga.data, chapters.data]);

  const toggleLibrary = useMutation({
    mutationFn: (v: boolean) => M.setInLibrary(id, v),
    onSuccess: (_d, v) => {
      toast(v ? 'Added to library' : 'Removed from library');
      refreshAll();
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: errorToast,
  });

  const setCategory = useMutation({
    mutationFn: ({ cid, on }: { cid: number; on: boolean }) =>
      M.setMangaCategories(id, on ? [cid] : [], on ? [] : [cid]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manga', id] });
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: errorToast,
  });

  const patch = useMutation({
    mutationFn: ({ ids, p }: { ids: number[]; p: { isRead?: boolean; isBookmarked?: boolean } }) =>
      M.updateChapters(ids, p),
    onSuccess: refreshAll,
    onError: errorToast,
  });

  const download = useMutation({
    mutationFn: (ids: number[]) => M.enqueueDownloads(ids),
    onSuccess: (_d, ids) => {
      toast(`Queued ${ids.length} chapter${ids.length === 1 ? '' : 's'}`);
      refreshAll();
    },
    onError: errorToast,
  });

  // Several chapters go through the paced downloader (a wait between chapters, so the source does not ban you).
  function paced(ids: number[]) {
    if (ids.length <= 1) return download.mutate(ids);
    const { added } = startPacedJob({ title: manga.data!.title, mangaId: id, ids });
    toast(
      `Paced download started: ${added} chapter${added === 1 ? '' : 's'}, about ${formatDuration(estimateWaitMs(paceConfig(settings), added))} of waiting. Follow it on the Downloads page.`,
    );
  }

  // With every group showing, "Download all" would queue each group's copy of every chapter. Offer one copy of each instead.
  // Returns the chapter ids to download, or null when the user backs out to pick a group first.
  function pickCopies(list: Chapter[]): number[] | null {
    const ids = list.map((c) => c.id);
    const groupCount = new Set(list.map((c) => groupOf(c))).size;
    if (activeGroup || groupCount < 2) return ids;
    const one = oneCopyEach(list).map((c) => c.id);
    if (one.length >= ids.length) return ids;
    const ok = confirm(
      `${groupCount} groups released this manga, so that is ${ids.length} downloads for ${one.length} chapters.

OK: download one copy of each chapter (${one.length}, from the biggest group).
Cancel: stop, so you can pick a group in the group bar first.`,
    );
    return ok ? one : null;
  }

  const removeDownloads = useMutation({
    mutationFn: (ids: number[]) => M.deleteDownloads(ids),
    onSuccess: () => {
      toast('Deleted downloads');
      refreshAll();
    },
    onError: errorToast,
  });

  const everything = chapters.data ?? []; // every chapter from every group, newest first (sourceOrder desc)
  // Chapters that linked sources add (numbers this source lacks): used when packing .cbz files.
  const linkedLists = useQueries({
    // A linked entry whose source is no longer installed can never download, so it adds no chapters to a .cbz.
    queries: (settings.links[String(id)] ?? []).map((l) => ({
      queryKey: ['linkedChapters', l.mangaId],
      queryFn: async () => ((await Q.manga(l.mangaId)).source ? Q.chapters(l.mangaId) : []),
      staleTime: 60_000,
    })),
  });
  const linkedData = linkedLists.map((q) => q.data);
  const groups = useMemo(() => listGroups(everything), [everything]);
  const groupPref = groupPrefFor(settings, id);
  // `all` = the chapters of the chosen group (or everything when no group is chosen)
  const all = useMemo(() => visibleChapters(everything, groupPref), [everything, groupPref]);
  // The .cbz exports follow the chosen group (and "fill gaps") like the reader does; with no group chosen they take one copy of
  // each chapter from the biggest group. Chapters only a linked source has are added on top.
  const packable = useMemo(
    () => withLinkedChapters(all, linkedData.filter((d): d is Chapter[] => !!d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, ...linkedData],
  );

  const volumeInfo = settings.volumes[String(id)];
  const desc = useMemo(() => parseDescription(manga.data?.description), [manga.data?.description]);

  // A lookup saved by an older parser may be incomplete (e.g. only 2 of 16 volumes): quietly redo it once.
  const redoneVolumes = useRef(false);
  useEffect(() => {
    // Volumes typed in by hand are never looked up again.
    if (!volumeInfo || (volumeInfo.source !== 'wikipedia' && volumeInfo.source !== 'fandom') || (volumeInfo.v ?? 1) >= PARSER_VERSION || redoneVolumes.current || !manga.data) return;
    redoneVolumes.current = true;
    findVolumes.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeInfo, manga.data]);
  // The server keeps a copy of the volumes with the manga: take it when this browser has none (or an older one),
  // and send ours when the server has none, so every browser and address ends up with the same volumes.
  useEffect(() => {
    if (!manga.data) return;
    const remote = volumeInfoFromMeta(manga.data.meta);
    const action = chooseSync(volumeInfo, remote);
    // A shortened Wikipedia copy is marked old (v: 1), so the page quietly reads the full details again, once.
    if (action === 'pull' && remote) setVolumeInfo(id, remote.slim && (remote.source === 'wikipedia' || remote.source === 'fandom') ? { ...remote, v: 1 } : remote);
    else if (action === 'push' && volumeInfo) pushVolumeMeta(id, volumeInfo);
    else if (action === 'none' && !volumeInfo && !remote) {
      // Nothing saved anywhere: a built-in rule for this series (shared with every user) fills it in, once.
      const rule = takeRule(id, manga.data.title);
      if (rule) saveVolumes(id, rule);
    }
    // Only when the manga loads: saving from the page already pushes by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manga.data, id]);
  const volumes = useMemo(() => summarizeVolumes(all, volumeInfo?.ranges), [all, volumeInfo]);
  // The numbered chapters that no volume covers yet, e.g. "122–123", for the "Not in a volume yet" heading.
  const unassignedRange = useMemo(() => {
    if (volumes.length === 0) return '';
    const nums = all.filter((c) => c.chapterNumber >= 0 && volumeOf(c, volumeInfo?.ranges) === null).map((c) => c.chapterNumber);
    if (nums.length === 0) return '';
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  }, [all, volumes, volumeInfo]);
  const activeVolume = volFilter !== null && volumes.some((v) => v.volume === volFilter) ? volFilter : null;

  const shown = useMemo(() => {
    let list = all.filter(
      (c) =>
        (!unreadOnly || !c.isRead) &&
        (!downloadedOnly || c.isDownloaded) &&
        (!bookmarkedOnly || c.isBookmarked) &&
        (activeVolume === null || volumeOf(c, volumeInfo?.ranges) === activeVolume),
    );
    if (asc) list = [...list].reverse();
    return list;
  }, [all, asc, unreadOnly, downloadedOnly, bookmarkedOnly, activeVolume, volumeInfo]);

  // Which chapter does the big "Continue" button open?
  const target: { chapter: Chapter; label: string } | null = useMemo(() => {
    if (!all.length) return null;
    const inProgress = [...all]
      .filter((c) => !c.isRead && c.lastPageRead > 0)
      .sort((a, b) => Number(b.lastReadAt) - Number(a.lastReadAt))[0];
    if (inProgress) return { chapter: inProgress, label: 'Continue' };
    const oldestFirst = [...all].reverse();
    const firstUnread = oldestFirst.find((c) => !c.isRead);
    if (firstUnread) {
      const anyRead = all.some((c) => c.isRead);
      return { chapter: firstUnread, label: anyRead ? 'Continue' : 'Start reading' };
    }
    return { chapter: oldestFirst[0], label: 'Read again' };
  }, [all]);

  function onRowSelect(c: Chapter, index: number, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked.current !== null) {
        const [a, b] = [lastClicked.current, index].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) next.add(shown[i].id);
      } else if (next.has(c.id)) next.delete(c.id);
      else next.add(c.id);
      return next;
    });
    lastClicked.current = index;
  }

  if (manga.isLoading || chapters.isLoading) return <Spinner />;
  if (manga.error) return <ErrorBox error={manga.error} retry={() => manga.refetch()} />;
  const m = manga.data!;
  const selIds = [...selected];
  const prefs = effectivePrefs(settings, id);
  const hasOverride = !!settings.perManga[String(id)];
  const inCats = new Set(m.categories.nodes.map((c) => c.id));
  const unread = all.filter((c) => !c.isRead).length;
  const activeGroup = groupPref?.group && groups.some((g) => g.name === groupPref.group) ? groupPref.group : null;

  return (
    <div className="page manga-page">
      <section className="hero">
        {backdrop.src && !backdrop.failed && <div className="hero-bg" style={{ backgroundImage: `url("${backdrop.src}")` }} />}
        <div className="hero-cover">
          <Cover path={m.thumbnailUrl} alt={m.title} />
        </div>
        <div className="hero-info">
          <h1>{m.title}</h1>
          <div className="meta-line">
            {m.author && <span>{m.author}</span>}
            {m.artist && m.artist !== m.author && <span>{m.artist}</span>}
            <span>{titleCase(m.status)}</span>
            {m.source && <span>{m.source.displayName}</span>}
            {desc.meta.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
          {desc.text && (
            <div className="desc-wrap">
              <p className={`desc ${expanded ? 'open' : ''}`} onClick={() => setExpanded(!expanded)}>
                {desc.text}
              </p>
              {expanded &&
                desc.extras.map((x) => (
                  <div key={x.label} className="desc-extra">
                    <b>{x.label}</b>
                    <p>{x.text}</p>
                  </div>
                ))}
              {(desc.text.length > 260 || desc.extras.length > 0) && (
                <button className="link-btn" onClick={() => setExpanded(!expanded)}>
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
          {m.genre?.length > 0 && (
            <div className="chips">
              {(allTags ? m.genre : m.genre.slice(0, TAG_LIMIT)).map((g) => (
                <span key={g} className="chip tagged" style={{ ['--tc' as string]: tagColor(g) }}>
                  {g}
                </span>
              ))}
              {m.genre.length > TAG_LIMIT && (
                <button className="chip chip-more" onClick={() => setAllTags(!allTags)}>
                  {allTags ? 'Show less' : `+${m.genre.length - TAG_LIMIT} more`}
                </button>
              )}
            </div>
          )}
          <div className="row gap wrap actions">
            {target && (
              <button className="btn primary big" onClick={() => nav(`/read/${id}/${target.chapter.id}`)}>
                {target.label} · {chapterLabel(target.chapter)}
              </button>
            )}
            <button className={`btn ${m.inLibrary ? '' : 'accent'}`} onClick={() => toggleLibrary.mutate(!m.inLibrary)}>
              {m.inLibrary ? '✓ In library' : '+ Add to library'}
            </button>
            {m.inLibrary && (
              <div className="popover-wrap">
                <button className="btn ghost" onClick={() => setCatOpen(!catOpen)}>
                  Categories
                </button>
                {catOpen && (
                  <div className="popover">
                    {(categories.data ?? []).filter((c) => c.id !== 0).length === 0 && (
                      <div className="muted small pad">No categories yet. Create them in your Suwayomi server.</div>
                    )}
                    {(categories.data ?? [])
                      .filter((c) => c.id !== 0)
                      .map((c) => (
                        <label key={c.id} className="check">
                          <input
                            type="checkbox"
                            checked={inCats.has(c.id)}
                            onChange={(e) => setCategory.mutate({ cid: c.id, on: e.target.checked })}
                          />
                          <span>{c.name}</span>
                        </label>
                      ))}
                  </div>
                )}
              </div>
            )}
            <button className="btn ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              {refresh.isPending ? 'Refreshing…' : 'Refresh'}
            </button>
            {m.realUrl && (
              <a className="btn ghost" href={m.realUrl} target="_blank" rel="noreferrer">
                Open original
              </a>
            )}
          </div>

          <RatingPanel title={m.title} />

          <LinkedSources
            id={id}
            title={m.title}
            sourceName={m.source?.displayName ?? 'this source'}
            sourceMissing={!m.source}
            chapters={everything}
            categoryIds={m.categories.nodes.map((c) => c.id)}
          />

          <LocalFiles key={folderKey} id={id} title={m.title} knownVolumes={volumeInfo?.ranges.map((r) => r.volume) ?? []} />

          <details className="reader-override">
            <summary>
              Reader settings for this manga{hasOverride ? ' (customised)' : ''}
            </summary>
            <div className="row gap wrap pad-top">
              <select
                className="input"
                value={prefs.mode}
                onChange={(e) => updateMangaPrefs(id, { mode: e.target.value as ReaderMode })}
              >
                <option value="paged">Paged</option>
                <option value="webtoon">Webtoon</option>
              </select>
              <select
                className="input"
                value={prefs.direction}
                onChange={(e) => updateMangaPrefs(id, { direction: e.target.value as Direction })}
                disabled={prefs.mode === 'webtoon'}
              >
                <option value="rtl">Right to left</option>
                <option value="ltr">Left to right</option>
              </select>
              <select className="input" value={prefs.fit} onChange={(e) => updateMangaPrefs(id, { fit: e.target.value as Fit })}>
                <option value="screen">Fit screen</option>
                <option value="width">Fit width</option>
                <option value="height">Fit height</option>
                <option value="original">Original</option>
              </select>
              {hasOverride && (
                <button className="btn ghost" onClick={() => updateMangaPrefs(id, null)}>
                  Reset to defaults
                </button>
              )}
            </div>
          </details>
        </div>
      </section>

      <section className="chapters">
        <div className="chapters-head">
          <h2>
            {all.length} chapters{activeGroup ? ` · ${activeGroup}` : ''} <span className="muted small">· {unread} unread</span>
          </h2>
          <div className="row gap wrap">
            <button className={`btn ghost ${unreadOnly ? 'on' : ''}`} onClick={() => setUnreadOnly(!unreadOnly)}>
              Unread
            </button>
            <button className={`btn ghost ${downloadedOnly ? 'on' : ''}`} onClick={() => setDownloadedOnly(!downloadedOnly)}>
              Downloaded
            </button>
            <button className={`btn ghost ${bookmarkedOnly ? 'on' : ''}`} onClick={() => setBookmarkedOnly(!bookmarkedOnly)}>
              Bookmarked
            </button>
            <button
              className="btn ghost"
              onClick={() => (volumeInfo ? checkVolumes.mutate() : findVolumes.mutate())}
              disabled={findVolumes.isPending || checkVolumes.isPending}
              title={volumeInfo ? 'Look for volumes released since this list was saved' : 'Look up which chapters belong to each official volume (Wikipedia)'}
            >
              {findVolumes.isPending || checkVolumes.isPending ? 'Looking up…' : volumeInfo ? 'Check for new volumes' : 'Find volumes'}
            </button>
            <button className="btn ghost" onClick={() => setEditVolumes(true)} title="Type or paste which chapters are in each volume">
              {volumeInfo ? `Edit volumes (${volumeInfo.ranges.length})` : 'Set volumes'}
            </button>
              <button
                className="btn ghost"
                onClick={() => pack(0)}
                title="Download every chapter as one .cbz (one copy per chapter, ordered by volume when known)"
              >
                ⬇ All as .cbz
              </button>
              {volumes.length > 0 && (
                <button
                  className="btn ghost"
                  onClick={packEachVolume}
                  title="Save every volume as its own .cbz into a folder you pick (files already there are skipped, so it can resume)"
                >
                  ⬇ Each volume as .cbz
                </button>
              )}
            <button className="btn ghost" onClick={() => setMergeOpen(true)} title="Join .cbz files you already downloaded (for example volumes) into one file">
              Merge .cbz files
            </button>
            <button className="btn ghost" onClick={() => setAsc(!asc)}>
              {asc ? '↑ Oldest first' : '↓ Newest first'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const ids = pickCopies(all.filter((c) => !c.isDownloaded && !c.isRead));
                if (ids === null) return;
                if (ids.length) paced(ids);
                else toast('No unread chapters left to download');
              }}
            >
              Download unread
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const ids = pickCopies(all.filter((c) => !c.isDownloaded));
                if (ids === null) return;
                if (ids.length) paced(ids);
                else toast('Everything here is already downloaded');
              }}
            >
              Download all{activeGroup ? ` (${activeGroup})` : ''}
            </button>
          </div>
        </div>

        {groups.length > 1 && (
          <div className="group-bar" role="group" aria-label="Scanlation groups">
            <span className="muted small group-label">Groups</span>
            <button
              className={`group-chip ${!activeGroup ? 'on' : ''}`}
              onClick={() => setGroupPref(id, null)}
              title="Show every chapter from every group"
            >
              All groups <span className="n">{everything.length}</span>
            </button>
            {groups.map((g) => (
              <button
                key={g.name}
                className={`group-chip ${activeGroup === g.name ? 'on' : ''}`}
                onClick={() => setGroupPref(id, { group: g.name, fill: groupPref?.fill ?? false })}
                title={`${g.count} chapters · ${g.unread} unread`}
              >
                {g.name} <span className="n">{g.count}</span>
              </button>
            ))}
            {activeGroup && (
              <label className="check group-fill" title="Also show chapters this group never released, taken from the other groups">
                <input
                  type="checkbox"
                  checked={groupPref?.fill ?? false}
                  onChange={(e) => setGroupPref(id, { group: activeGroup, fill: e.target.checked })}
                />
                <span>Fill gaps from other groups</span>
              </label>
            )}
          </div>
        )}

        {volumes.length > 0 && (
          <div className="volume-bar" role="group" aria-label="Official volumes">
            <div className="volume-bar-head">
              <span className="muted small">
                Official volumes
                {!volumeInfo
                  ? ' · from chapter names'
                  : volumeInfo.source === 'manual'
                    ? ' · entered by hand'
                    : volumeInfo.source === 'rule'
                      ? ` · from the built-in list (${volumeInfo.page})`
                      : volumeInfo.source === 'fandom'
                        ? ` · from a Fandom wiki (${volumeInfo.page})`
                        : ` · from Wikipedia (${volumeInfo.page})`}
              </span>
              <span className="row gap">
                {volumeInfo?.source === 'manual' && (
                  <button className="link-btn" onClick={() => setShareVolumes(true)} title="Add this list to the shared one, so the series fills in for everyone">
                    Share
                  </button>
                )}
                {volumeInfo && (
                  <button className="link-btn" onClick={() => saveVolumes(id, null)} title="Forget these volumes (here and on the server)">
                    Remove
                  </button>
                )}
              </span>
            </div>
            <div className="volume-strip">
              {volumes.map((v) => (
                <button
                  key={v.volume}
                  className={`volume-chip ${activeVolume === v.volume ? 'on' : ''} ${v.unread === 0 ? 'done' : ''}`}
                  style={{ ['--vc' as string]: volumeColor(v.volume) }}
                  onClick={() => setVolFilter(activeVolume === v.volume ? null : v.volume)}
                  title={`${v.count} chapters · ${v.unread} unread`}
                >
                  <b>Vol. {v.volume}</b>
                  <span>
                    {Number.isFinite(v.first) ? `Ch. ${v.first}${v.last !== v.first ? `–${v.last}` : ''}` : `${v.count} ch.`}
                  </span>
                  <span className="vol-state">{v.unread === 0 ? '✓ read' : `${v.unread} unread`}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selIds.length > 0 && (
          <div className="bulkbar sticky">
            <span>{selIds.length} selected</span>
            <button className="btn" onClick={() => patch.mutate({ ids: selIds, p: { isRead: true } })}>
              Mark read
            </button>
            <button className="btn" onClick={() => patch.mutate({ ids: selIds, p: { isRead: false } })}>
              Mark unread
            </button>
            <button className="btn ghost" onClick={() => patch.mutate({ ids: selIds, p: { isBookmarked: true } })}>
              Bookmark
            </button>
            <button className="btn ghost" onClick={() => paced(selIds)}>
              Download
            </button>
            <button className="btn ghost" onClick={() => removeDownloads.mutate(selIds)}>
              Delete downloads
            </button>
            <button className="btn ghost" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="center-note muted">{all.length ? 'No chapters match these filters.' : 'No chapters yet.'}</div>
        ) : (
          <ul className="chapter-list">
            {shown.map((c, i) => {
              const started = !c.isRead && c.lastPageRead > 0;
              const vol = volumes.length ? volumeOf(c, volumeInfo?.ranges) : null;
              const newVolume = volumes.length > 0 && (i === 0 || volumeOf(shown[i - 1], volumeInfo?.ranges) !== vol);
              const volStyle = vol === null ? undefined : { ['--vc' as string]: volumeColor(vol) };
              const volClass = vol === null ? '' : 'in-volume';
              return (
                <Fragment key={c.id}>
                  {newVolume && (
                    <li className={`volume-divider ${volClass}`} style={volStyle}>
                      <span>{vol === null ? `Not in a volume yet${unassignedRange ? ` · ch. ${unassignedRange}` : ''}` : `Volume ${vol}`}</span>
                      {vol === null && (
                        <span className="row gap">
                          <button className="link-btn" onClick={() => checkVolumes.mutate()} disabled={checkVolumes.isPending}>
                            Check for new volumes
                          </button>
                          <button className="link-btn" onClick={() => setEditVolumes(true)}>
                            Edit volumes
                          </button>
                        </span>
                      )}
                      {vol !== null && (
                        <span className="row gap">
                          <button
                            className="link-btn"
                            onClick={() =>
                              setSelected(new Set(shown.filter((x) => volumeOf(x, volumeInfo?.ranges) === vol).map((x) => x.id)))
                            }
                          >
                            Select volume
                          </button>
                          <button
                            className="link-btn"
                            disabled={exporting.some((j) => j.volume === vol)}
                            onClick={() => pack(vol)}
                            title="Download this volume as one .cbz comic file"
                          >
                            {exporting.some((j) => j.volume === vol) ? 'Exporting… (see Downloads)' : '⬇ Download .cbz'}
                          </button>
                        </span>
                      )}
                    </li>
                  )}
                <li
                  className={`chapter ${volClass} ${c.isRead ? 'is-read' : ''} ${selected.has(c.id) ? 'selected' : ''}`}
                  style={volStyle}
                >
                  <input
                    type="checkbox"
                    className="chapter-check"
                    checked={selected.has(c.id)}
                    onChange={() => undefined}
                    onClick={(e) => onRowSelect(c, i, e.shiftKey)}
                    aria-label={`Select ${chapterLabel(c)}`}
                  />
                  <Link to={`/read/${id}/${c.id}`} className="chapter-main">
                    <div className="chapter-title">
                      {c.isBookmarked && <span className="bm">★</span>}
                      {chapterLabel(c)}
                    </div>
                    <div className="muted small">
                      {[
                        Number(c.uploadDate) ? timeAgo(c.uploadDate) : null,
                        c.scanlator,
                        started ? `Page ${c.lastPageRead + 1}${c.pageCount ? `/${c.pageCount}` : ''}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </Link>
                  <div className="chapter-actions">
                    {c.isDownloaded ? (
                      <button className="icon-btn ok" title="Downloaded – click to delete" onClick={() => removeDownloads.mutate([c.id])}>
                        ✓
                      </button>
                    ) : (
                      <button className="icon-btn" title="Download" onClick={() => download.mutate([c.id])}>
                        ⬇
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title={c.isRead ? 'Mark unread' : 'Mark read'}
                      onClick={() => patch.mutate({ ids: [c.id], p: { isRead: !c.isRead } })}
                    >
                      {c.isRead ? '○' : '●'}
                    </button>
                  </div>
                </li>
                </Fragment>
              );
            })}
          </ul>
        )}
      </section>

      {mergeOpen && <MergeDialog series={m.title} onClose={() => setMergeOpen(false)} />}
      {shareVolumes && volumeInfo && <ShareDialog title={m.title} ranges={volumeInfo.ranges} onClose={() => setShareVolumes(false)} />}

      {editVolumes && (
        <VolumeDialog
          title={m.title}
          initial={volumeInfo?.ranges}
          current={volumeInfo ? { source: volumeInfo.source, page: volumeInfo.page } : undefined}
          onClose={() => setEditVolumes(false)}
          onSave={(ranges) => {
            setEditVolumes(false);
            // Opened and saved without changing anything: leave the list (and where it came from) as it is.
            if (sameRanges(volumeInfo?.ranges, ranges)) return void toast('No changes');
            // A changed list counts as hand-made, so lookups never overwrite it; dates, ISBNs and titles of kept volumes stay.
            saveVolumes(id, { source: 'manual', v: PARSER_VERSION, page: 'entered by hand', ranges: keepExtras(ranges, volumeInfo?.ranges) });
            toast(`Saved ${ranges.length} volume${ranges.length === 1 ? '' : 's'}`);
          }}
        />
      )}
    </div>
  );
}
