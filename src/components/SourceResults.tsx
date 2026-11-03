import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { M, Q } from '../api/queries';
import { MangaCard } from './Cover';
import { Empty } from './ui';
import { queryWords, titleHasWords } from '../lib/search';
import { useSettings } from '../lib/settings';
import { useImage } from '../lib/useImage';

const PER_SOURCE = 12;
const PARALLEL = 6; // sources asked at the same time

function SourceIcon({ path }: { path: string }) {
  const { src } = useImage(path);
  return src ? <img className="icon" src={src} alt="" loading="lazy" /> : <div className="icon placeholder" />;
}

/**
 * Search every English source for a title and list what contains the typed words, one section per source.
 * Sources are asked a few at a time; each answer lets the next one start.
 */
export default function SourceResults({ query }: { query: string }) {
  const settings = useSettings();
  const sources = useQuery({ queryKey: ['sources'], queryFn: Q.sources });
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 500);
    return () => clearTimeout(t);
  }, [query]);

  const list = useMemo(
    () => (sources.data ?? []).filter((s) => s.lang === 'en').sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [sources.data],
  );
  const enabled = term.length >= 2;
  const [finished, setFinished] = useState(0);
  const results = useQueries({
    queries: list.map((s, i) => ({
      queryKey: ['everywhere', s.id, term],
      queryFn: () => M.fetchSourceManga(s.id, 'SEARCH', 1, term),
      enabled: enabled && i < finished + PARALLEL,
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const done = results.filter((r) => r.isSuccess || r.isError).length;
  useEffect(() => setFinished(done), [done]);
  useEffect(() => setFinished(0), [term]);
  const words = useMemo(() => queryWords(term), [term]);

  const rows = list.map((source, i) => {
    const r = results[i];
    const all = r?.data?.mangas ?? [];
    const hits = all.filter((m) => titleHasWords(m.title, words));
    const shown = onlyMatches ? hits : [...hits, ...all.filter((m) => !hits.includes(m))];
    return { source, searching: !!r && r.isFetching, error: r?.error as Error | null | undefined, hits, shown };
  });
  const pending = rows.filter((r) => r.searching || (enabled && !results[rows.indexOf(r)]?.isFetched && !r.error)).length;
  const found = rows.reduce((n, r) => n + r.hits.length, 0);
  const sections = rows.filter((r) => r.shown.length > 0).sort((a, b) => b.hits.length - a.hits.length);
  const failed = rows.filter((r) => r.error);
  const count = `${found} title${found === 1 ? '' : 's'} containing “${term}”`;

  if (sources.isLoading) return <p className="muted small">Loading sources…</p>;
  if (list.length === 0) return <Empty title="No English sources" hint="Install an extension from Browse to search for titles." />;

  return (
    <>
      <div className="row gap wrap match-bar">
        <span className="muted small">
          {!enabled
            ? 'Type at least 2 letters'
            : pending > 0
              ? `Searching ${list.length} English sources · ${count} so far`
              : `${count} in ${list.length} English sources`}
        </span>
        <label className="check">
          <input type="checkbox" checked={onlyMatches} onChange={(e) => setOnlyMatches(e.target.checked)} />
          <span>Only titles containing the word{words.length > 1 ? 's' : ''}</span>
        </label>
      </div>

      {enabled && pending === 0 && sections.length === 0 && (
        <Empty title="Nothing found" hint="No source has a title containing that. Try a shorter word, or untick the filter." />
      )}

      {sections.map(({ source, shown, hits }) => (
        <section key={source.id} className="everywhere-source">
          <div className="row gap everywhere-head">
            <SourceIcon path={source.iconUrl} />
            <h3>{source.name}</h3>
            <span className="muted small">
              {hits.length} match{hits.length === 1 ? '' : 'es'}
            </span>
            <Link className="link-btn everywhere-more" to={`/browse/${source.id}?q=${encodeURIComponent(term)}`}>
              Open in {source.name}
            </Link>
          </div>
          <div className="grid" style={{ ['--cw' as string]: `${Math.min(settings.gridWidth, 150)}px` }}>
            {shown.slice(0, PER_SOURCE).map((m) => (
              <MangaCard key={m.id} id={m.id} title={m.title} thumbnailUrl={m.thumbnailUrl} inLibrary={m.inLibrary} />
            ))}
          </div>
        </section>
      ))}

      {failed.length > 0 && <p className="muted small">Could not search: {failed.map((f) => f.source.name).join(', ')}.</p>}
    </>
  );
}
