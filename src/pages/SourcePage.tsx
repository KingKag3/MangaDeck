import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { M, Q } from '../api/queries';
import { MangaCard } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Spinner, Tabs } from '../components/ui';
import { useSettings } from '../lib/settings';
import { queryWords, titleHasWords } from '../lib/search';

type Mode = 'POPULAR' | 'LATEST' | 'SEARCH';

export default function SourcePage() {
  const { sourceId = '' } = useParams();
  const settings = useSettings();
  const sources = useQuery({ queryKey: ['sources'], queryFn: Q.sources });
  const source = sources.data?.find((s) => s.id === sourceId);

  const [mode, setMode] = useState<Mode>('POPULAR');
  const [params] = useSearchParams();
  const start = params.get('q') ?? ''; // e.g. a link from a recommendation
  const [input, setInput] = useState(start);
  const [query, setQuery] = useState(start.trim());

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  const effectiveMode: Mode = query ? 'SEARCH' : mode === 'SEARCH' ? 'POPULAR' : mode;

  const feed = useInfiniteQuery({
    queryKey: ['source-feed', sourceId, effectiveMode, query],
    queryFn: ({ pageParam }) => M.fetchSourceManga(sourceId, effectiveMode, pageParam, query || undefined),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.hasNextPage ? all.length + 1 : undefined),
    staleTime: 5 * 60_000,
    enabled: !!sourceId,
  });

  const items = useMemo(() => {
    const seen = new Set<number>();
    const out = [];
    for (const p of feed.data?.pages ?? []) {
      for (const m of p.mangas) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      }
    }
    return out;
  }, [feed.data]);

  // Sources search loosely ("hero" also brings back Horimiya). Keep the titles that contain the typed words,
  // and keep loading pages until there are enough of them.
  const [onlyMatches, setOnlyMatches] = useState(true);
  const words = useMemo(() => queryWords(query), [query]);
  const matching = useMemo(() => items.filter((m) => titleHasWords(m.title, words)), [items, words]);
  const filtering = !!query && onlyMatches;
  const pages = feed.data?.pages.length ?? 0;
  useEffect(() => {
    if (filtering && matching.length < 24 && feed.hasNextPage && !feed.isFetchingNextPage && pages < 8) feed.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtering, matching.length, feed.hasNextPage, feed.isFetchingNextPage, pages]);
  const shown = !query ? items : filtering ? matching : [...matching, ...items.filter((m) => !matching.includes(m))];

  return (
    <div className="page">
      <PageHeader title={source?.displayName ?? 'Source'}>
        <Link className="btn ghost" to="/browse">
          ← Sources
        </Link>
        <input
          className="input search"
          type="search"
          placeholder={`Search ${source?.name ?? 'this source'}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </PageHeader>

      {!query && (
        <Tabs
          value={mode === 'SEARCH' ? 'POPULAR' : mode}
          onChange={setMode}
          items={[
            { value: 'POPULAR', label: 'Popular' },
            ...(source?.supportsLatest ? [{ value: 'LATEST' as Mode, label: 'Latest' }] : []),
          ]}
        />
      )}

      {feed.isLoading && <Spinner label="Asking the source…" />}
      {feed.error && <ErrorBox error={feed.error} retry={() => feed.refetch()} />}
      {query && !feed.isLoading && !feed.error && items.length > 0 && (
        <div className="row gap wrap match-bar">
          <span className="muted small">
            {matching.length} title{matching.length === 1 ? '' : 's'} containing “{query}”
            {feed.hasNextPage ? ' so far' : ''}
          </span>
          <label className="check">
            <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
            <span>Only titles containing the word{words.length > 1 ? 's' : ''}</span>
          </label>
        </div>
      )}
      {!feed.isLoading && !feed.error && shown.length === 0 && (
        <Empty title="No results" hint={filtering && items.length > 0 ? 'The source returned titles, but none contain your search. Untick the filter to see them.' : undefined} />
      )}

      <div className="grid" style={{ ['--cw' as string]: `${settings.gridWidth}px` }}>
        {shown.map((m) => (
          <MangaCard key={m.id} id={m.id} title={m.title} thumbnailUrl={m.thumbnailUrl} inLibrary={m.inLibrary} />
        ))}
      </div>

      {feed.hasNextPage && (
        <div className="center-note">
          <button className="btn" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
