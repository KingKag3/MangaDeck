import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type Chapter, type MangaBase } from '../api/queries';
import { migrateSeries } from '../lib/migrate';
import { startPacedJob } from '../lib/pacer';
import { queryWords, titleHasWords } from '../lib/search';
import { setLinks, useSettings } from '../lib/settings';
import { missingFromLinked, type LinkedSource } from '../lib/sourceLinks';
import { errorToast, toast } from './ui';

const PARALLEL = 6; // sources asked at the same time

interface Hit {
  manga: MangaBase;
  source: string;
}

/**
 * "Other sources" on a manga page: find the same series on another source and link it. Linked sources fill chapters this
 * source lacks (download them, include them in .cbz files), are tried when a chapter will not download, and one of them can
 * become the main source ("Move here").
 */
export default function LinkedSources({
  id,
  title,
  sourceName,
  chapters,
  categoryIds,
  sourceMissing = false,
}: {
  id: number;
  title: string;
  sourceName: string;
  sourceMissing?: boolean;
  chapters: Chapter[];
  categoryIds: number[];
}) {
  const settings = useSettings();
  const qc = useQueryClient();
  const nav = useNavigate();
  const links = settings.links[String(id)] ?? [];
  const sources = useQuery({ queryKey: ['sources'], queryFn: Q.sources });
  const [term, setTerm] = useState(title);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const linked = useQueries({
    queries: links.map((l) => ({ queryKey: ['chapters', l.mangaId], queryFn: () => Q.chapters(l.mangaId), staleTime: 60_000 })),
  });

  const sourceNames = useMemo(() => new Map((sources.data ?? []).map((s) => [s.id, s.displayName])), [sources.data]);

  async function search() {
    const list = (sources.data ?? []).filter((s) => s.lang === 'en');
    const words = queryWords(term);
    if (words.length === 0 || list.length === 0) return;
    setHits([]);
    setSearching({ done: 0, total: list.length });
    const skip = new Set([id, ...links.map((l) => l.mangaId)]);
    let done = 0;
    for (let i = 0; i < list.length; i += PARALLEL) {
      const batch = list.slice(i, i + PARALLEL);
      const found = await Promise.all(
        batch.map((s) =>
          M.fetchSourceManga(s.id, 'SEARCH', 1, term.trim())
            .then((r) => r.mangas.filter((m) => titleHasWords(m.title, words) && !skip.has(m.id)).map((manga): Hit => ({ manga, source: s.displayName })))
            .catch(() => [] as Hit[]),
        ),
      );
      done += batch.length;
      setHits((prev) => [...(prev ?? []), ...found.flat()]);
      setSearching({ done, total: list.length });
    }
    setSearching(null);
  }

  async function link(h: Hit) {
    setBusy(h.manga.id);
    try {
      // The entry needs its chapter list before it can fill anything.
      await M.refreshManga(h.manga.id, true, true);
      qc.invalidateQueries({ queryKey: ['chapters', h.manga.id] });
      setLinks(id, [...links, { mangaId: h.manga.id, title: h.manga.title, source: h.source }]);
      setHits((prev) => (prev ?? []).filter((x) => x.manga.id !== h.manga.id));
      toast(`Linked ${h.manga.title} on ${h.source}`);
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(null);
    }
  }

  function unlink(l: LinkedSource) {
    setLinks(id, links.filter((x) => x.mangaId !== l.mangaId));
  }

  async function refreshLinked(l: LinkedSource) {
    setBusy(l.mangaId);
    try {
      await M.refreshManga(l.mangaId, false, true);
      await qc.invalidateQueries({ queryKey: ['chapters', l.mangaId] });
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(null);
    }
  }

  function fill(l: LinkedSource, missing: Chapter[]) {
    const ids = missing.filter((c) => !c.isDownloaded).map((c) => c.id);
    if (ids.length === 0) return toast('Everything missing is already downloaded');
    if (ids.length === 1) {
      M.enqueueDownloads(ids).then(() => toast('Queued 1 chapter'), errorToast);
      return;
    }
    const { added } = startPacedJob({ title: `${title} (from ${l.source})`, mangaId: l.mangaId, ids });
    toast(`Paced download started: ${added} chapters from ${l.source}. Follow it on the Downloads page.`);
  }

  async function move(l: LinkedSource) {
    if (
      !confirm(
        `Make “${l.title}” on ${l.source} your main source for this series?\n\nIt joins your library in the same categories, chapters you read are marked read there, and the old entry leaves the library but stays linked as a fallback. Downloads are kept.`,
      )
    )
      return;
    setBusy(l.mangaId);
    try {
      const r = await migrateSeries({ fromId: id, fromTitle: title, fromSource: sourceName, toId: l.mangaId, categoryIds, keepOld: !sourceMissing });
      await qc.invalidateQueries();
      toast(`Moved. ${r.read} chapter${r.read === 1 ? '' : 's'} marked read${r.bookmarks ? `, ${r.bookmarks} bookmark${r.bookmarks === 1 ? '' : 's'} kept` : ''}.`);
      nav(`/manga/${l.mangaId}`);
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="reader-override linked-sources" >
      <summary>
        Other sources{links.length ? ` (${links.length} linked)` : ''}
        {sourceMissing && <span className="linked-warn-tag"> · source missing, open to fix</span>}
      </summary>
      {sourceMissing && (
        <p className="linked-warn small">
          The source this series came from is no longer installed, so it cannot download or update. Link it on a working source below, then press
          “Move here”.
        </p>
      )}
      <p className="muted small pad-top">
        Find this series on other sources and link as many as you like. Chapters this source is missing can be downloaded from the linked ones, and
        a chapter that keeps failing here is tried on each of them in turn (also in .cbz exports). You can also make a linked source the main one.
      </p>

      {links.map((l, i) => {
        const q = linked[i];
        const data = q?.data;
        const missing = data ? missingFromLinked(chapters, data) : [];
        return (
          <div key={l.mangaId} className="linked-row">
            <div className="grow">
              <Link to={`/manga/${l.mangaId}`} className="row-title">
                {l.title}
              </Link>
              <div className="muted small">
                {l.source}
                {data ? ` · ${data.length} chapters · ${missing.length ? `${missing.length} that this source lacks` : 'nothing missing here'}` : q?.isLoading ? ' · loading…' : ''}
              </div>
            </div>
            <div className="row gap wrap">
              {missing.length > 0 && (
                <button className="btn" disabled={busy === l.mangaId} onClick={() => fill(l, missing)}>
                  Download {missing.length} missing
                </button>
              )}
              <button className="btn ghost" disabled={busy === l.mangaId} onClick={() => refreshLinked(l)}>
                Refresh
              </button>
              <button className="btn ghost" disabled={busy === l.mangaId} onClick={() => move(l)}>
                Move here
              </button>
              <button className="btn ghost" onClick={() => unlink(l)} aria-label="Unlink">
                ✕
              </button>
            </div>
          </div>
        );
      })}

      <div className="row gap wrap pad-top">
        <input className="input grow" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !searching && search()} placeholder="Title to look for" />
        <button className="btn" onClick={search} disabled={!!searching || term.trim().length < 2 || sources.isLoading}>
          {searching ? `Searching ${searching.done}/${searching.total}…` : 'Find on other sources'}
        </button>
      </div>

      {hits && !searching && hits.length === 0 && <p className="muted small">Nothing found. Try fewer words.</p>}
      {hits && hits.length > 0 && (
        <ul className="list linked-hits">
          {hits.map((h) => (
            <li key={h.manga.id} className="list-row">
              <div className="grow">
                <div className="row-title">{h.manga.title}</div>
                <div className="muted small">{sourceNames.get(h.manga.sourceId) ?? h.source}</div>
              </div>
              <button className="btn" disabled={busy === h.manga.id} onClick={() => link(h)}>
                {busy === h.manga.id ? 'Linking…' : 'Link'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
