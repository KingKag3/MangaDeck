import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type Chapter } from '../api/queries';
import { Cover } from '../components/Cover';
import { useImage } from '../lib/useImage';
import { ErrorBox, Spinner, errorToast, toast } from '../components/ui';
import { chapterLabel, parseDescription, timeAgo, titleCase } from '../lib/format';
import { listGroups, visibleChapters } from '../lib/groups';
import { PARSER_VERSION, lookupVolumes, mergeNewVolumes, seriesChapters, summarizeVolumes, volumeChapters, volumeColor, volumeOf, type VolumeRange } from '../lib/volumes';
import VolumeDialog from '../components/VolumeDialog';
import { markSeen } from '../lib/fresh';
import { chooseSync, pushVolumeMeta, saveVolumes, volumeInfoFromMeta } from '../lib/volumeStore';
import { estimateWaitMs, formatDuration, paceConfig, sleep, startPacedJob, waitMs } from '../lib/pacer';
import { buildCbz, canPickFolder, canSaveToDisk, fileSizeIn, pickFolder, pickSaveFile, queueAndWait, safeFileName, saveBlob, type PackMeta } from '../lib/export';
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

const TAG_LIMIT = 8;

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

  // volume: the volume being packed, or 0 for the whole series
  const [packing, setPacking] = useState<{
    volume: number;
    done: number;
    total: number;
    phase: 'downloading' | 'packing';
    batch?: { index: number; total: number };
  } | null>(null);
  const packAbort = useRef<AbortController | null>(null);

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
    if (packing) return;
    const ranges = settings.volumes[String(id)]?.ranges;
    const items =
      volume === 0
        ? seriesChapters(everything, ranges)
        : volumeChapters(everything, ranges, volume).map((chapter) => ({ chapter, volume }));
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
    const writable = handle ? await handle.createWritable() : null;
    const abort = new AbortController();
    packAbort.current = abort;
    try {
      // First let Suwayomi download the chapters, so they show in Downloads and packing reads the local copies.
      const missing = items.filter((i) => !i.chapter.isDownloaded).map((i) => i.chapter.id);
      if (missing.length) {
        setPacking({ volume, done: 0, total: missing.length, phase: 'downloading' });
        const failed = await queueAndWait(missing, (done, total) => setPacking({ volume, done, total, phase: 'downloading' }), abort.signal);
        refreshAll();
        if (failed) toast(`${failed} chapter${failed === 1 ? '' : 's'} failed to download; fetching from the source instead`, 'error');
      }
      setPacking({ volume, done: 0, total: items.length, phase: 'packing' });
      const { blob, fileName, pages } = await buildCbz({
        series,
        items,
        volume: volume === 0 ? undefined : volume,
        meta: packMeta(volume, ranges),
        sink: writable ? (part) => writable.write(part) : undefined,
        onProgress: (p) => setPacking({ volume, done: p.chapter, total: p.chapters, phase: 'packing' }),
        signal: abort.signal,
      });
      if (writable) await writable.close();
      else if (blob) saveBlob(blob, fileName);
      toast(`Saved ${writable ? suggested : fileName} (${items.length} chapters, ${pages} pages)`);
    } catch (e) {
      if (writable) await writable.abort().catch(() => undefined);
      if (abort.signal.aborted) toast('Cancelled');
      else errorToast(e);
    } finally {
      packAbort.current = null;
      setPacking(null);
    }
  }

  /** Every volume as its own .cbz, into one folder you pick. Files already in the folder are skipped, so it can resume. */
  async function packEachVolume() {
    if (packing) return;
    const ranges = settings.volumes[String(id)]?.ranges;
    const list = summarizeVolumes(everything, ranges).map((v) => v.volume);
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
    }
    const abort = new AbortController();
    packAbort.current = abort;
    const cfg = paceConfig(settings);
    let saved = 0;
    let skipped = 0;
    try {
      for (const [i, volume] of list.entries()) {
        abort.signal.throwIfAborted();
        const fileName = `${safeFileName(series)} - Vol. ${String(volume).padStart(2, '0')}.cbz`;
        if (dir && (await fileSizeIn(dir, fileName)) > 0) {
          skipped++;
          continue;
        }
        const items = volumeChapters(everything, ranges, volume).map((chapter) => ({ chapter, volume }));
        const batch = { index: i + 1, total: list.length };
        const missing = items.filter((it) => !it.chapter.isDownloaded).map((it) => it.chapter.id);
        if (missing.length) {
          setPacking({ volume, done: 0, total: missing.length, phase: 'downloading', batch });
          const failed = await queueAndWait(missing, (done, total) => setPacking({ volume, done, total, phase: 'downloading', batch }), abort.signal);
          refreshAll();
          if (failed) toast(`Vol. ${volume}: ${failed} chapter${failed === 1 ? '' : 's'} failed to download; fetching from the source instead`, 'error');
        }
        setPacking({ volume, done: 0, total: items.length, phase: 'packing', batch });
        const writable = dir ? await (await dir.getFileHandle(fileName, { create: true })).createWritable() : null;
        try {
          const { blob } = await buildCbz({
            series,
            items,
            volume,
            meta: packMeta(volume, ranges),
            sink: writable ? (part) => writable.write(part) : undefined,
            onProgress: (p) => setPacking({ volume, done: p.chapter, total: p.chapters, phase: 'packing', batch }),
            signal: abort.signal,
          });
          if (writable) await writable.close();
          else if (blob) saveBlob(blob, fileName);
          saved++;
        } catch (e) {
          // Do not leave a half-written (or empty) file behind: the next run would think it is done.
          if (writable) {
            await writable.abort().catch(() => undefined);
            await dir?.removeEntry(fileName).catch(() => undefined);
          }
          throw e;
        }
        // Same politeness as between chapters, before the next volume starts downloading.
        if (missing.length && i < list.length - 1) await sleep(waitMs(cfg, 1), abort.signal);
      }
      toast(`Saved ${saved} volume file${saved === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} already in the folder` : ''}`);
    } catch (e) {
      if (abort.signal.aborted) toast(`Cancelled after ${saved} volume file${saved === 1 ? '' : 's'}`);
      else errorToast(e);
    } finally {
      packAbort.current = null;
      setPacking(null);
    }
  }

  const findVolumes = useMutation({
    mutationFn: () => lookupVolumes(manga.data!.title),
    onSuccess: (info) => {
      if (info) {
        saveVolumes(id, info);
        toast(`Found ${info.ranges.length} volumes ${info.source === 'rule' ? 'in the built-in list' : 'on Wikipedia'}`);
      } else toast('No chapter-by-volume list found for this title. Use “Set volumes” to enter them by hand.', 'error');
    },
    onError: errorToast,
  });
  // Look again for volumes released since the saved list. A list read from Wikipedia is simply replaced; one from the
  // built-in rules or typed by hand only gets the newer volumes added, so nothing you corrected is lost.
  const checkVolumes = useMutation({
    mutationFn: () => lookupVolumes(manga.data!.title, { skipRules: true }),
    onSuccess: (found) => {
      const cur = settings.volumes[String(id)];
      if (!found) return void toast('No volume list found online. Use “Edit volumes” to add the new volume by hand.', 'error');
      if (!cur || cur.source === 'wikipedia') {
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

  const removeDownloads = useMutation({
    mutationFn: (ids: number[]) => M.deleteDownloads(ids),
    onSuccess: () => {
      toast('Deleted downloads');
      refreshAll();
    },
    onError: errorToast,
  });

  const everything = chapters.data ?? []; // every chapter from every group, newest first (sourceOrder desc)
  const groups = useMemo(() => listGroups(everything), [everything]);
  const groupPref = settings.groups[String(id)];
  // `all` = the chapters of the chosen group (or everything when no group is chosen)
  const all = useMemo(() => visibleChapters(everything, groupPref), [everything, groupPref]);

  const volumeInfo = settings.volumes[String(id)];
  const desc = useMemo(() => parseDescription(manga.data?.description), [manga.data?.description]);

  // A lookup saved by an older parser may be incomplete (e.g. only 2 of 16 volumes): quietly redo it once.
  const redoneVolumes = useRef(false);
  useEffect(() => {
    // Volumes typed in by hand are never looked up again.
    if (!volumeInfo || volumeInfo.source !== 'wikipedia' || (volumeInfo.v ?? 1) >= PARSER_VERSION || redoneVolumes.current || !manga.data) return;
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
    if (action === 'pull' && remote) setVolumeInfo(id, remote);
    else if (action === 'push' && volumeInfo) pushVolumeMeta(id, volumeInfo);
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
          </div>
          {m.genre?.length > 0 && (
            <div className="chips">
              {(allTags ? m.genre : m.genre.slice(0, TAG_LIMIT)).map((g) => (
                <span key={g} className="chip">
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
          {desc.meta.length > 0 && <div className="desc-meta">{desc.meta.join('  ·  ')}</div>}
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
              {volumeInfo ? 'Edit volumes' : 'Set volumes'}
            </button>
            {packing ? (
              <button className="btn ghost" onClick={() => packAbort.current?.abort()}>
                {packing.phase === 'downloading' ? 'Downloading' : 'Packing'} {packing.volume === 0 ? '' : `Vol. ${packing.volume}${packing.batch ? ` (${packing.batch.index} of ${packing.batch.total})` : ''} `}{packing.done}/{packing.total} · Cancel
              </button>
            ) : (
              <>
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
              </>
            )}
            <button className="btn ghost" onClick={() => setAsc(!asc)}>
              {asc ? '↑ Oldest first' : '↓ Newest first'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const ids = all.filter((c) => !c.isDownloaded && !c.isRead).map((c) => c.id);
                if (ids.length) paced(ids);
                else toast('No unread chapters left to download');
              }}
            >
              Download unread
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const ids = all.filter((c) => !c.isDownloaded).map((c) => c.id);
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
                      : ` · from Wikipedia (${volumeInfo.page})`}
              </span>
              <span className="row gap">
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
                            disabled={!!packing}
                            onClick={() => pack(vol)}
                            title="Download this volume as one .cbz comic file"
                          >
                            {packing?.volume === vol ? `${packing.phase === 'downloading' ? 'Downloading' : 'Packing'} ${packing.done}/${packing.total}…` : '⬇ Download .cbz'}
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

      {editVolumes && (
        <VolumeDialog
          title={m.title}
          initial={volumeInfo?.ranges}
          onClose={() => setEditVolumes(false)}
          onSave={(ranges) => {
            saveVolumes(id, { source: 'manual', v: PARSER_VERSION, page: 'entered by hand', ranges });
            setEditVolumes(false);
            toast(`Saved ${ranges.length} volume${ranges.length === 1 ? '' : 's'}`);
          }}
        />
      )}
    </div>
  );
}
