import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Q } from '../api/queries';
import { chapterLabel } from './format';
import { logDownload } from './history';
import { getExportJobs } from './exportJobs';
import { getJobs, handledIds } from './pacer';

interface Seen {
  mangaId: number;
  title: string;
  label: string;
}

/**
 * Is this chapter part of a .cbz export or paced job? Those jobs may run in another tab (only one tab runs them), whose
 * `handledIds` this tab cannot see, but the saved jobs are shared, so look there. The job logs it (or the .cbz entry does).
 */
function belongsToJob(id: number): boolean {
  return getExportJobs().some((j) => j.items.some((i) => i.id === id) || Object.values(j.alt ?? {}).some((a) => a.id === id)) || getJobs().some((j) => j.queue.includes(id) || j.current === id);
}

/**
 * Logs downloads Mangadeck does not drive itself (the per-chapter Download button, auto-download while reading, anything
 * queued in Suwayomi's own UI). A chapter that leaves the server's queue and is on disk counts as finished. Paced jobs and
 * .cbz packing log their own downloads, so those chapters are skipped. Runs from Layout while the tab is visible.
 */
export function useDownloadWatch() {
  const { data } = useQuery({ queryKey: ['download-watch'], queryFn: Q.downloads, refetchInterval: 4000, retry: false });
  const seen = useRef(new Map<number, Seen>());

  useEffect(() => {
    if (!data) return;
    const now = new Map<number, Seen>();
    for (const it of data.queue) {
      now.set(it.chapter.id, { mangaId: it.manga.id, title: it.manga.title, label: chapterLabel(it.chapter) });
    }
    const gone = [...seen.current.entries()].filter(([id]) => !now.has(id));
    seen.current = now;
    for (const [id, s] of gone) {
      if (handledIds.has(id) || belongsToJob(id)) continue;
      Q.chapterDownloaded(id)
        .then((ok) => ok && logDownload({ kind: 'chapter', mangaId: s.mangaId, title: s.title, label: s.label, ok: true }))
        .catch(() => undefined);
    }
  }, [data]);
}
