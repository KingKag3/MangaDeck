import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { M, type Chapter } from '../api/queries';
import { autoLink, chaptersToMark, fetchRemoteProgress, isConnected, pushProgress, searchAniList, setLink, useTracker, type Candidate } from '../lib/tracker';
import { errorToast, toast } from './ui';

/**
 * AniList tracking for one series: which AniList entry it is, a "Sync now", and a way to pick another entry.
 * Only shown once AniList is connected in Settings. Progress is pushed as you finish chapters (see lib/tracker.ts).
 */
export default function TrackerPanel({ mangaId, title, chapters }: { mangaId: number; title: string; chapters: Chapter[] }) {
  const t = useTracker();
  const link = t.links[String(mangaId)];
  const connected = isConnected(t);
  const [choosing, setChoosing] = useState(false);
  const [term, setTerm] = useState(title);
  const [tried, setTried] = useState(false);

  // Link the entry whose name equals the title once, quietly.
  useEffect(() => {
    if (!connected || link || tried) return;
    setTried(true);
    void autoLink(mangaId, title).catch(() => undefined);
  }, [connected, link, tried, mangaId, title]);

  const qc = useQueryClient();
  const search = useMutation({ mutationFn: (s: string) => searchAniList(s), onError: errorToast });
  const sync = useMutation({
    mutationFn: async () => {
      const read = chapters.filter((c) => c.isRead && c.chapterNumber >= 1).map((c) => c.chapterNumber);
      if (!read.length) throw new Error('No chapter is marked read yet.');
      const r = await pushProgress(mangaId, Math.max(...read));
      if (!r.ok) throw new Error(r.reason);
      return r;
    },
    onSuccess: (r) => toast(r.changed ? `AniList progress set to chapter ${r.progress}` : `AniList is already at chapter ${r.progress} or further`),
    onError: errorToast,
  });

  const pull = useMutation({
    mutationFn: async () => {
      const progress = await fetchRemoteProgress(mangaId);
      if (progress === null) throw new Error('AniList has no entry for you on this series yet.');
      const ids = chaptersToMark(chapters, progress);
      if (ids.length) await M.updateChapters(ids, { isRead: true });
      return { progress, marked: ids.length };
    },
    onSuccess: ({ progress, marked }) => {
      toast(marked ? `Marked ${marked} chapter${marked === 1 ? '' : 's'} read from AniList (up to chapter ${progress})` : `Nothing to mark: chapters up to ${progress} are already read here`);
      for (const k of ['chapters', 'manga']) qc.invalidateQueries({ queryKey: [k, mangaId] });
      qc.invalidateQueries({ queryKey: ['library'] });
    },
    onError: errorToast,
  });

  if (!connected) return null;

  function choose(c: Candidate) {
    setLink(mangaId, c);
    setChoosing(false);
    toast(`Tracking “${c.title}” on AniList`);
  }

  return (
    <details className="reader-override tracker-panel" open={choosing || undefined}>
      <summary>
        {link ? (
          <>
            Tracking on AniList <span className="muted small">· {link.title}</span>
          </>
        ) : (
          'Track on AniList'
        )}
      </summary>
      <div className="pad-top">
        {link ? (
          <p className="small">
            Linked to{' '}
            <a href={link.url} target="_blank" rel="noreferrer">
              {link.title}
            </a>
            {link.total ? ` (${link.total} chapters)` : ''}. Finishing a chapter, or marking it read, moves your AniList progress forward (never back).
          </p>
        ) : (
          <p className="small muted">No AniList entry has exactly this title. Pick the right one to start tracking.</p>
        )}
        <div className="row gap wrap">
          {link && (
            <button className="btn ghost" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? 'Syncing…' : 'Send my progress'}
            </button>
          )}
          {link && (
            <button className="btn ghost" onClick={() => pull.mutate()} disabled={pull.isPending} title="Mark chapters read here up to the chapter AniList has for you">
              {pull.isPending ? 'Reading AniList…' : 'Get progress from AniList'}
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              setChoosing(true);
              search.mutate(term);
            }}
          >
            {link ? 'Change entry…' : 'Find the entry…'}
          </button>
          {link && (
            <button className="btn ghost" onClick={() => setLink(mangaId, null)}>
              Stop tracking
            </button>
          )}
        </div>
        {link && t.queue[String(mangaId)] && (
          <p className="muted small">Chapter {t.queue[String(mangaId)]} is waiting to be sent: AniList could not be reached. It is retried automatically.</p>
        )}
        {choosing && (
          <div className="pad-top">
            <div className="row gap">
              <input className="input grow" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search.mutate(term)} />
              <button className="btn" onClick={() => search.mutate(term)} disabled={search.isPending}>
                Search AniList
              </button>
            </div>
            <ul className="merge-list track-results">
              {(search.data?.all ?? []).map((c) => (
                <li key={c.id} className="row gap">
                  {c.cover && <img className="track-cover" src={c.cover} alt="" referrerPolicy="no-referrer" loading="lazy" />}
                  <span className="grow">
                    {c.title} <span className="muted small">{[c.format, c.chapters ? `${c.chapters} ch.` : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button className="link-btn" onClick={() => choose(c)}>
                    Choose
                  </button>
                </li>
              ))}
              {search.data && search.data.all.length === 0 && <li className="muted small">Nothing found.</li>}
            </ul>
            <p className="muted small">Only the text you search for is sent to AniList.</p>
          </div>
        )}
      </div>
    </details>
  );
}
