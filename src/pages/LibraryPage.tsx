import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type LibraryManga } from '../api/queries';
import { MangaCard } from '../components/Cover';
import { Cover } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Spinner, Tabs, errorToast, toast } from '../components/ui';
import { updateSettings, useSettings } from '../lib/settings';
import { fetchRecommendations, pickSeeds } from '../lib/recommend';

type Sort = 'title' | 'unread' | 'lastRead' | 'added' | 'updated';

interface View {
  sort: Sort;
  desc: boolean;
  unreadOnly: boolean;
  downloadedOnly: boolean;
}

const VIEW_KEY = 'mangadeck.libview';

function loadView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { sort: 'title', desc: false, unreadOnly: false, downloadedOnly: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { sort: 'title', desc: false, unreadOnly: false, downloadedOnly: false };
}

function sortFn(sort: Sort): (a: LibraryManga, b: LibraryManga) => number {
  switch (sort) {
    case 'unread':
      return (a, b) => a.unreadCount - b.unreadCount;
    case 'lastRead':
      return (a, b) => Number(a.lastReadChapter?.lastReadAt ?? 0) - Number(b.lastReadChapter?.lastReadAt ?? 0);
    case 'added':
      return (a, b) => Number(a.inLibraryAt) - Number(b.inLibraryAt);
    case 'updated':
      return (a, b) => Number(a.latestFetchedChapter?.fetchedAt ?? 0) - Number(b.latestFetchedChapter?.fetchedAt ?? 0);
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
  useEffect(() => {
    if (!viewOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.popover-wrap')) setViewOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [viewOpen]);
  const activeFilters = Number(view.unreadOnly) + Number(view.downloadedOnly) + Number(view.desc);
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

  const runUpdate = useMutation({
    mutationFn: M.updateLibrary,
    onSuccess: () => {
      toast('Checking your library for new chapters…');
      qc.invalidateQueries({ queryKey: ['updater'] });
    },
    onError: errorToast,
  });

  // Refresh the library when an update run finishes.
  const running = updater.data?.isRunning;
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (running) setWasRunning(true);
    else if (wasRunning) {
      setWasRunning(false);
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['updates'] });
    }
  }, [running, wasRunning, qc]);

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
    const q = search.trim().toLowerCase();
    let list = mangas.filter((m) => {
      if (cat !== 'all' && !inCategory(m, cat)) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      if (view.unreadOnly && m.unreadCount === 0) return false;
      if (view.downloadedOnly && m.downloadCount === 0) return false;
      return true;
    });
    const cmp = sortFn(view.sort);
    list = [...list].sort((a, b) => (view.desc ? -cmp(a, b) : cmp(a, b)));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mangas, cat, search, view]);

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
        </select>
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
          <div className="shelf-row">
            {continueReading.map((m) => (
              <Link key={m.id} to={`/manga/${m.id}`} className="shelf-item" title={m.title}>
                <Cover path={m.thumbnailUrl} alt={m.title} />
                <span className="shelf-title">{m.title}</span>
                <span className="muted small">{m.unreadCount} unread</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {cat === 'all' && !search && !selecting && recs.data && recs.data.length > 0 && (
        <section className="shelf recs">
          <h2>
            Recommended for you <span className="muted small">· from AniList, based on what you read</span>
          </h2>
          <div className="shelf-row">
            {recs.data.map((r) => (
              <Link
                key={r.id}
                to={`/browse/${encodeURIComponent(r.sourceId)}?q=${encodeURIComponent(r.title)}`}
                className="shelf-item rec-item"
                title={`${r.title}
Because you read ${r.because.join(', ')}
Search in your source`}
              >
                <div className="cover">{r.cover && <img src={r.cover} alt={r.title} loading="lazy" referrerPolicy="no-referrer" />}</div>
                <span className="shelf-title">{r.title}</span>
                <span className="muted small">
                  {r.score ? `★ ${(r.score / 10).toFixed(1)} · ` : ''}
                  {r.because.length > 1 ? `${r.because.length} matches` : `Like ${r.because[0]}`}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {visible.length === 0 ? (
        mangas.length === 0 ? (
          <Empty title="Your library is empty" hint="Install an extension, then browse a source and add something.">
            <Link className="btn primary" to="/browse">
              Browse sources
            </Link>
          </Empty>
        ) : (
          <Empty title="Nothing matches" hint="Try clearing the search or filters." />
        )
      ) : (
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
      )}
    </div>
  );
}
