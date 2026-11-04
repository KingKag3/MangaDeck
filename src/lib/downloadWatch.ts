import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Q } from '../api/queries';
import { chapterLabel } from './format';
import { logDownload } from './history';
import { handledIds } from './pacer';

interface Seen {
  mangaId: number;
  title: string;
  label: string;
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
      if (handledIds.has(id)) continue;
      Q.chapterDownloaded(id)
        .then((ok) => ok && logDownload({ kind: 'chapter', mangaId: s.mangaId, title: s.title, label: s.label, ok: true }))
        .catch(() => undefined);
    }
  }, [data]);
}
