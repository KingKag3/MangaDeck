import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type Chapter } from '../api/queries';
import { Cover } from '../components/Cover';
import { ErrorBox, Spinner, errorToast, toast } from '../components/ui';
import { chapterLabel, timeAgo, titleCase } from '../lib/format';
import { listGroups, visibleChapters } from '../lib/groups';
import {
  effectivePrefs,
  setGroupPref,
  updateMangaPrefs,
  useSettings,
  type Direction,
  type Fit,
  type ReaderMode,
} from '../lib/settings';

export default function MangaPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const nav = useNavigate();
  const qc = useQueryClient();
  const settings = useSettings();

  const manga = useQuery({ queryKey: ['manga', id], queryFn: () => Q.manga(id) });
  const chapters = useQuery({ queryKey: ['chapters', id], queryFn: () => Q.chapters(id) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: Q.categories });

  const [expanded, setExpanded] = useState(false);
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

  const shown = useMemo(() => {
    let list = all.filter(
      (c) => (!unreadOnly || !c.isRead) && (!downloadedOnly || c.isDownloaded) && (!bookmarkedOnly || c.isBookmarked),
    );
    if (asc) list = [...list].reverse();
    return list;
  }, [all, asc, unreadOnly, downloadedOnly, bookmarkedOnly]);

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
              {m.genre.map((g) => (
                <span key={g} className="chip">
                  {g}
                </span>
              ))}
            </div>
          )}
          {m.description && (
            <p className={`desc ${expanded ? 'open' : ''}`} onClick={() => setExpanded(!expanded)}>
              {m.description.replace(/\*\*(.+?)\*\*/g, '$1')}
            </p>
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
            <button className="btn ghost" onClick={() => setAsc(!asc)}>
              {asc ? '↑ Oldest first' : '↓ Newest first'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const ids = all.filter((c) => !c.isDownloaded && !c.isRead).map((c) => c.id);
                if (ids.length) download.mutate(ids);
                else toast('No unread chapters left to download');
              }}
            >
              Download unread
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                const ids = all.filter((c) => !c.isDownloaded).map((c) => c.id);
                if (ids.length) download.mutate(ids);
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
            <button className="btn ghost" onClick={() => download.mutate(selIds)}>
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
              return (
                <li key={c.id} className={`chapter ${c.isRead ? 'is-read' : ''} ${selected.has(c.id) ? 'selected' : ''}`}>
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
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
