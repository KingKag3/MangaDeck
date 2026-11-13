import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type LibraryManga } from '../api/queries';
import { MangaCard } from '../components/Cover';
import { Cover } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Shelf, Spinner, Tabs, errorToast, toast } from '../components/ui';
import { updateSettings, useSettings } from '../lib/settings';
import { queryWords, titleHasWords } from '../lib/search';
import { byScore, useLibraryScores } from '../lib/scores';
import { chapterLabel, toMs } from '../lib/format';
import { newestChapterReleased } from '../lib/latest';
import { dismissAllFresh, useFresh } from '../lib/fresh';
import { markManualUpdate, startLibraryUpdate } from '../lib/libraryUpdate';
import { dismissVolumeNews, useVolumeNews } from '../lib/volumeWatch';
import { startPacedJob } from '../lib/pacer';
import { groupPrefFor, visibleChapters } from '../lib/groups';
import { fetchPopular, fetchRecommendations, pickSeeds, type Recommendation } from '../lib/recommend';
import RecDialog, { RecPeek } from '../components/RecDialog';
import SourceResults from '../components/SourceResults';

type Sort = 'title' | 'unread' | 'lastRead' | 'added' | 'updated' | 'score';

interface View {
  sort: Sort;
  desc: boolean;
  unreadOnly: boolean;
  downloadedOnly: boolean;
  /** Hide titles whose AniList score is known and below this (0 = off). */
  minScore: number;
}

const VIEW_KEY = 'mangadeck.libview';

function loadView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { sort: 'title', desc: false, unreadOnly: false, downloadedOnly: false, minScore: 0, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { sort: 'title', desc: false, unreadOnly: false, downloadedOnly: false, minScore: 0 };
}

/** When the newest chapter came out (the source's upload date). fetchedAt is only when we pulled the list, so it is the fallback. */
export function latestChapterAt(m: LibraryManga): number {
  return toMs(m.latestUploadedChapter?.uploadDate) || toMs(m.latestFetchedChapter?.fetchedAt);
}

/** Title runs A to Z; every other sort starts with the most (unread) or newest (dates). "Reverse order" flips it. */
function sortFn(sort: Sort, released: Map<number, number>, scores: Map<number, number | null>): (a: LibraryManga, b: LibraryManga) => number {
  switch (sort) {
    case 'score':
      return (a, b) => byScore(scores.get(a.id), scores.get(b.id));
    case 'unread':
      return (a, b) => b.unreadCount - a.unreadCount;
    case 'lastRead':
      return (a, b) => Number(b.lastReadChapter?.lastReadAt ?? 0) - Number(a.lastReadChapter?.lastReadAt ?? 0);
    case 'added':
      return (a, b) => Number(b.inLibraryAt) - Number(a.inLibraryAt);
    case 'updated':
      return (a, b) => (released.get(b.id) || latestChapterAt(b)) - (released.get(a.id) || latestChapterAt(a));
    default:
      return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  }
}

export default function LibraryPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const lib = useQuery({ queryKey: ['library'], queryFn: Q.library });
  const cats = useQuery({ queryKey: ['categories'], queryFn: Q.categories });

  const [cat, setCat] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>(loadView);
  const [viewOpen, setViewOpen] = useState(false);
  // Chapter dates for every title are a big query, so it only runs when sorting by latest chapter.
  const dates = useQuery({ queryKey: ['chapterDates'], queryFn: Q.chapterDates, enabled: view.sort === 'updated', staleTime: 5 * 60_000 });
  const released = useMemo(
    () => new Map((dates.data ?? []).map((m) => [m.id, newestChapterReleased(m.chapters.nodes)] as const)),
    [dates.data],
  );
  // AniList scores for every title: one search each (cached), only while sorting or filtering by score.
  const wantScores = view.sort === 'score' || view.minScore > 0;
  const scoreItems = useMemo(() => (lib.data ?? []).map((m) => ({ id: m.id, title: m.title })), [lib.data]);
  const lscores = useLibraryScores(scoreItems, wantScores);
  const [openRec, setOpenRec] = useState<Recommendation | null>(null);

  // Hovering a recommendation shows its description after a short pause, so no extra click is needed.
  const [peek, setPeek] = useState<{ rec: Recommendation; rect: DOMRect } | null>(null);
  const peekTimer = useRef<number | undefined>(undefined);
  const showPeek = (rec: Recommendation, el: HTMLElement) => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek({ rec, rect: el.getBoundingClientRect() }), 350);
  };
  const hidePeek = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(null);
  };
  useEffect(() => {
    window.addEventListener('scroll', hidePeek, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', hidePeek, { capture: true });
  }, []);
  useEffect(() => {
    if (!viewOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.popover-wrap')) setViewOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [viewOpen]);
  const activeFilters = Number(view.unreadOnly) + Number(view.downloadedOnly) + Number(view.desc) + Number(view.minScore > 0);
  // Also look for the typed title in the English sources (to find something new to add).
  const [inSources, setInSources] = useState(() => {
    try {
      return localStorage.getItem('mangadeck.libsources') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mangadeck.libsources', inSources ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [inSources]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      /* ignore */
    }
  }, [view]);

  const updater = useQuery({
    queryKey: ['updater'],
    queryFn: Q.updaterStatus,
    refetchInterval: (q) => (q.state.data?.isRunning ? 2000 : false),
  });

  const volumeNews = useVolumeNews();
  const fresh = useFresh();
  const freshIds = Object.keys(fresh);
  const [onlyFresh, setOnlyFresh] = useState(false);

  const runUpdate = useMutation({
    mutationFn: () => {
      markManualUpdate();
      return startLibraryUpdate(qc);
    },
    onSuccess: () => {
      toast('Checking your library for new chapters…');
      // The server skips titles by its own rules; when that is everything it starts no job and says nothing.
      setTimeout(async () => {
        try {
          const st = await qc.fetchQuery({ queryKey: ['updater'], queryFn: Q.updaterStatus, staleTime: 0 });
          if (!st.isRunning && st.totalJobs === 0)
            toast('Nothing was checked: the server skips titles with unread chapters, not started or completed. Change that in Settings, Library.', 'error');
        } catch {
          /* the next poll will show it */
        }
      }, 2500);
    },
    onError: errorToast,
  });

  // The finished run is handled by useLibraryUpdates (Layout), so it works from any page.
  const running = updater.data?.isRunning;

  const mangas = lib.data ?? [];
  const categories = cats.data ?? [];

  const seeds = useMemo(() => pickSeeds(mangas), [mangas]);
  const seedKey = seeds.map((m) => m.id).join(',');
  const recs = useQuery({
    queryKey: ['recommendations', seedKey],
    queryFn: () => fetchRecommendations(seeds, mangas),
    enabled: seeds.length > 0,
    staleTime: 6 * 3600_000,
    retry: false,
  });

  // What is trending on AniList, shown above the personal recommendations. Links search in the source of the first title.
  const popSource = seeds[0]?.sourceId ?? mangas[0]?.sourceId ?? '';
  const popular = useQuery({
    queryKey: ['popular', popSource],
    queryFn: () => fetchPopular(mangas, popSource),
    enabled: !!popSource,
    staleTime: 6 * 3600_000,
    retry: false,
  });

  // Manga with no category live in the "Default" category (id 0).
  const inCategory = (m: LibraryManga, id: number) =>
    id === 0 ? m.categories.nodes.length === 0 : m.categories.nodes.some((c) => c.id === id);

  const tabs = useMemo(() => {
    const out: { value: string; label: string; count: number }[] = [{ value: 'all', label: 'All', count: mangas.length }];
    for (const c of categories) {
      const count = mangas.filter((m) => inCategory(m, c.id)).length;
      if (c.id === 0 && count === 0) continue;
      out.push({ value: String(c.id), label: c.id === 0 ? 'Default' : c.name, count });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mangas, categories]);

  const visible = useMemo(() => {
    const words = queryWords(search);
    let list = mangas.filter((m) => {
      if (cat !== 'all' && !inCategory(m, cat)) return false;
      if (!titleHasWords(m.title, words)) return false;
      if (view.unreadOnly && m.unreadCount === 0) return false;
      if (view.downloadedOnly && m.downloadCount === 0) return false;
      if (view.minScore > 0) {
        const sc = lscores.scores.get(m.id);
        if (sc != null && sc < view.minScore) return false; // unknown scores stay visible
      }
      if (onlyFresh && freshIds.length > 0 && fresh[String(m.id)] === undefined) return false;
      return true;
    });
    const cmp = sortFn(view.sort, released, lscores.scores);
    list = [...list].sort((a, b) => (view.desc ? -cmp(a, b) : cmp(a, b)));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mangas, cat, search, view, onlyFresh, fresh, released, lscores.scores]);

  // Bring the highlighted titles up to date: download their new chapters, paced so the sources do not ban you.
  async function downloadNew() {
    let titles = 0;
    let chapters = 0;
    try {
      for (const m of mangas.filter((x) => fresh[String(x.id)] !== undefined)) {
        const all = await Q.chapters(m.id); // newest first
        const shown = visibleChapters(all, groupPrefFor(settings, m.id));
        const ids = shown
          .slice(0, fresh[String(m.id)])
          .filter((c) => !c.isDownloaded)
          .map((c) => c.id);
        if (!ids.length) continue;
        startPacedJob({ title: m.title, mangaId: m.id, ids });
        titles++;
        chapters += ids.length;
      }
      toast(
        titles
          ? `Paced download started: ${chapters} new chapter${chapters === 1 ? '' : 's'} in ${titles} title${titles === 1 ? '' : 's'}. Follow it on the Downloads page.`
          : 'The new chapters are already downloaded',
      );
    } catch (e) {
      errorToast(e);
    }
  }

  const continueReading = useMemo(() => {
    if (cat !== 'all' || search || selecting) return [];
    return mangas
      .filter((m) => m.lastReadChapter && Number(m.lastReadChapter.lastReadAt) > 0 && m.unreadCount > 0)
      .sort((a, b) => Number(b.lastReadChapter!.lastReadAt) - Number(a.lastReadChapter!.lastReadAt))
      .slice(0, 10);
  }, [mangas, cat, search, selecting]);

  function toggleSelect(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function bulkRemove() {
    try {
      await Promise.all([...selected].map((id) => M.setInLibrary(id, false)));
      toast(`Removed ${selected.size} from library`);
      setSelected(new Set());
      setSelecting(false);
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (e) {
      errorToast(e);
    }
  }

  async function bulkCategory(id: number) {
    try {
      await Promise.all([...selected].map((m) => M.setMangaCategories(m, [id], [])));
      toast(`Added ${selected.size} to category`);
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (e) {
      errorToast(e);
    }
  }

  if (lib.isLoading) return <Spinner label="Loading your library…" />;
  if (lib.error) return <ErrorBox error={lib.error} retry={() => lib.refetch()} />;

  const recItem = (r: Recommendation) => (
    <div key={r.id} className="shelf-item rec-item" onMouseEnter={(e) => showPeek(r, e.currentTarget)} onMouseLeave={hidePeek}>
      <Link to={`/find?q=${encodeURIComponent(r.title)}`} className="rec-link">
        <div className="cover">{r.cover && <img src={r.cover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />}</div>
        <span className="shelf-title">{r.title}</span>
        <span className="muted small">
          {r.score ? `★ ${(r.score / 10).toFixed(1)} · ` : ''}
          {r.rank ? `Trending #${r.rank}` : r.because.length > 1 ? `${r.because.length} matches` : `Like ${r.because[0]}`}
        </span>
      </Link>
      <button
        type="button"
        className="rec-info"
        aria-label={`Details for ${r.title}`}
        title="Details"
        onClick={() => {
          hidePeek();
          setOpenRec(r);
        }}
      >
        i
      </button>
    </div>
  );

  return (
    <div className="page">
      <PageHeader title="Library">
        <input
          className="input search"
          type="search"
          placeholder="Search library"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={`btn ghost ${inSources ? 'on' : ''}`}
          onClick={() => setInSources(!inSources)}
          aria-pressed={inSources}
          title="Also search the title in your English sources"
        >
          + Sources
        </button>
        <select
          className="input"
          value={view.sort}
          onChange={(e) => setView({ ...view, sort: e.target.value as Sort })}
          aria-label="Sort by"
        >
          <option value="title">Title</option>
          <option value="unread">Unread count</option>
          <option value="lastRead">Last read</option>
          <option value="added">Date added</option>
          <option value="updated">Latest chapter</option>
          <option value="score">AniList score</option>
        </select>
        {wantScores && (lscores.error || lscores.loaded < scoreItems.length) && (
          <span className="muted small" title={lscores.error || undefined}>
            {lscores.error ? 'Scores paused' : `Scores ${lscores.loaded}/${scoreItems.length}`}
          </span>
        )}
        <div className="popover-wrap">
          <button
            className={`btn ghost ${viewOpen || activeFilters > 0 ? 'on' : ''}`}
            onClick={() => setViewOpen(!viewOpen)}
            aria-expanded={viewOpen}
          >
            View{activeFilters > 0 ? ` · ${activeFilters}` : ''}
          </button>
          {viewOpen && (
            <div className="popover popover-right view-pop">
              <label className="check">
                <input type="checkbox" checked={view.desc} onChange={(e) => setView({ ...view, desc: e.target.checked })} />
                <span>Reverse order</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={view.unreadOnly}
                  onChange={(e) => setView({ ...view, unreadOnly: e.target.checked })}
                />
                <span>Only unread</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={view.downloadedOnly}
                  onChange={(e) => setView({ ...view, downloadedOnly: e.target.checked })}
                />
                <span>Only downloaded</span>
              </label>
              <label className="field">
                <span>Hide titles scored below</span>
                <select className="input" value={view.minScore} onChange={(e) => setView({ ...view, minScore: Number(e.target.value) })}>
                  <option value={0}>Show all</option>
                  {[60, 70, 75, 80, 85].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field density">
                <span>Cover size</span>
                <input
                  type="range"
                  min={100}
                  max={260}
                  step={10}
                  value={settings.gridWidth}
                  onChange={(e) => updateSettings({ gridWidth: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </div>
        <button
          className={`btn ghost ${selecting ? 'on' : ''}`}
          onClick={() => {
            setSelecting(!selecting);
            setSelected(new Set());
          }}
        >
          {selecting ? 'Done' : 'Select'}
        </button>
        <button className="btn" disabled={running || runUpdate.isPending} onClick={() => runUpdate.mutate()}>
          {running ? `Updating ${updater.data?.finishedJobs ?? 0}/${updater.data?.totalJobs ?? 0}` : 'Check for updates'}
        </button>
      </PageHeader>

      {tabs.length > 1 && <Tabs value={String(cat)} onChange={(v) => setCat(v === 'all' ? 'all' : Number(v))} items={tabs} />}

      {volumeNews.length > 0 && !selecting && (
        <div className="fresh-bar">
          <span>
            New volumes:{' '}
            {volumeNews.map((n, i) => (
              <span key={n.mangaId}>
                {i > 0 && ', '}
                <Link to={`/manga/${n.mangaId}`}>
                  <b>{n.title}</b>
                </Link>{' '}
                {n.what}
              </span>
            ))}
          </span>
          <button className="btn ghost" onClick={dismissVolumeNews}>
            Dismiss
          </button>
        </div>
      )}

      {freshIds.length > 0 && !selecting && (
        <div className="fresh-bar">
          <span>
            <b>{freshIds.length}</b> title{freshIds.length === 1 ? '' : 's'} with new chapters since your last check
          </span>
          <div className="row gap wrap">
            <button className={`btn ghost ${onlyFresh ? 'on' : ''}`} onClick={() => setOnlyFresh(!onlyFresh)}>
              Show only these
            </button>
            <button className="btn" onClick={downloadNew} title="Download each title's new chapters, one at a time with a pause between">
              Download new chapters
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                dismissAllFresh();
                setOnlyFresh(false);
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {selecting && (
        <div className="bulkbar">
          <span>{selected.size} selected</span>
          <select
            className="input"
            value=""
            onChange={(e) => e.target.value && bulkCategory(Number(e.target.value))}
            disabled={!selected.size}
          >
            <option value="">Add to category…</option>
            {categories
              .filter((c) => c.id !== 0)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <button className="btn danger" disabled={!selected.size} onClick={bulkRemove}>
            Remove from library
          </button>
          <button className="btn ghost" onClick={() => setSelected(new Set(visible.map((m) => m.id)))}>
            Select all
          </button>
        </div>
      )}

      {continueReading.length > 0 && (
        <section className="shelf">
          <h2>Continue reading</h2>
          <Shelf>
            {continueReading.map((m) => (
              <Link
                key={m.id}
                to={m.firstUnreadChapter ? `/read/${m.id}/${m.firstUnreadChapter.id}` : `/manga/${m.id}`}
                className="shelf-item"
                title={m.firstUnreadChapter ? `${m.title}: continue with ${m.firstUnreadChapter.name}` : m.title}
              >
                <Cover path={m.thumbnailUrl} alt={m.title} />
                <span className="shelf-title">{m.title}</span>
                <span className="muted small">
                  {m.firstUnreadChapter ? `Continue · ${chapterLabel(m.firstUnreadChapter)}` : `${m.unreadCount} unread`}
                </span>
              </Link>
            ))}
          </Shelf>
        </section>
      )}

      {cat === 'all' && !search && !selecting && popular.data && popular.data.length > 0 && (
        <section className="shelf recs">
          <h2>
            What's popular <span className="muted small">· trending on AniList right now</span>
          </h2>
          <Shelf>{popular.data.map((r) => recItem(r))}</Shelf>
        </section>
      )}

      {cat === 'all' && !search && !selecting && recs.data && recs.data.length > 0 && (
        <section className="shelf recs">
          <h2>
            Recommended for you <span className="muted small">· from AniList, based on what you read</span>
          </h2>
          <Shelf>{recs.data.map((r) => recItem(r))}</Shelf>
        </section>
      )}

      {inSources && search.trim().length >= 2 && !selecting && (
        <section className="from-sources">
          <h2>From your sources</h2>
          <SourceResults query={search} />
        </section>
      )}

      {peek && !openRec && <RecPeek rec={peek.rec} anchor={peek.rect} />}
      {openRec && <RecDialog rec={openRec} onClose={() => setOpenRec(null)} />}

      {visible.length === 0 ? (
        mangas.length === 0 ? (
          <Empty title="Your library is empty" hint="Install an extension, then browse a source and add something.">
            <Link className="btn primary" to="/browse">
              Browse sources
            </Link>
          </Empty>
        ) : (
          <Empty title="Nothing matches" hint="Try clearing the search or filters.">
            {search.trim().length >= 2 && !inSources && (
              <button className="btn primary" onClick={() => setInSources(true)}>
                Search your sources for “{search.trim()}”
              </button>
            )}
          </Empty>
        )
      ) : (
        <>
        <div className="lib-head">
          <h2>
            Your library <span className="muted small">· {visible.length === mangas.length ? `${mangas.length} titles` : `${visible.length} of ${mangas.length} titles`}</span>
          </h2>
        </div>
        <div className="grid" style={{ ['--cw' as string]: `${settings.gridWidth}px` }}>
          {visible.map((m) => (
            <MangaCard
              key={m.id}
              id={m.id}
              title={m.title}
              thumbnailUrl={m.thumbnailUrl}
              unread={settings.showBadges ? m.unreadCount : 0}
              downloaded={settings.showBadges ? m.downloadCount : 0}
              selected={selected.has(m.id)}
              fresh={fresh[String(m.id)]}
              onClick={
                selecting
                  ? (e) => {
                      e.preventDefault();
                      toggleSelect(m.id);
                    }
                  : undefined
              }
            />
          ))}
        </div>
        </>
      )}
    </div>
  );
}
