import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { M, Q } from '../api/queries';
import { MangaCard } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Spinner, Tabs } from '../components/ui';
import { useSettings } from '../lib/settings';

type Mode = 'POPULAR' | 'LATEST' | 'SEARCH';

export default function SourcePage() {
  const { sourceId = '' } = useParams();
  const settings = useSettings();
  const sources = useQuery({ queryKey: ['sources'], queryFn: Q.sources });
  const source = sources.data?.find((s) => s.id === sourceId);

  const [mode, setMode] = useState<Mode>('POPULAR');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

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
      {!feed.isLoading && !feed.error && items.length === 0 && <Empty title="No results" />}

      <div className="grid" style={{ ['--cw' as string]: `${settings.gridWidth}px` }}>
        {items.map((m) => (
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
