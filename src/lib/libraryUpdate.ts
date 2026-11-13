import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { M, Q, type LibraryManga } from '../api/queries';
import { toast } from '../components/ui';
import { recordNewChapters, snapshotCounts } from './fresh';
import { getSettings } from './settings';
import { checkNewVolumes } from './volumeWatch';

/**
 * Library update runs ("Check for updates"), from the button or on a schedule. Suwayomi does the checking; this watches
 * the run from any page, and when it ends compares chapter counts with the ones saved at the start so the library can
 * highlight what grew.
 */

const LAST_KEY = 'mangadeck.autoUpdateAt';
const CHECK_EVERY_MS = 5 * 60_000;

/** Chapters per title, keyed by id: what a finished update is compared against. */
export const chapterCounts = (list: LibraryManga[]) => Object.fromEntries(list.map((m) => [String(m.id), m.chapters.totalCount]));

/** True when the person pressed the button: only then is "no new chapters" worth a toast. */
let manual = false;
export function markManualUpdate() {
  manual = true;
}

/** Save today's chapter counts, then ask the server to update the library. */
export async function startLibraryUpdate(qc: QueryClient) {
  const lib = await qc.fetchQuery({ queryKey: ['library'], queryFn: Q.library, staleTime: 0 });
  snapshotCounts(chapterCounts(lib));
  await M.updateLibrary();
  void qc.invalidateQueries({ queryKey: ['updater'] });
}

/** Hours between automatic checks (0 = off), and when the last one started. */
function due(): boolean {
  const hours = getSettings().autoCheckHours;
  if (!hours) return false;
  try {
    return Date.now() - Number(localStorage.getItem(LAST_KEY) || 0) >= hours * 3_600_000;
  } catch {
    return false;
  }
}

/**
 * Mounted once in Layout. Watches the server's update status (so a run that finishes while you are on another page still
 * highlights its new chapters) and starts a run on the chosen schedule while Mangadeck is open.
 */
export function useLibraryUpdates() {
  const qc = useQueryClient();
  const updater = useQuery({
    queryKey: ['updater'],
    queryFn: Q.updaterStatus,
    refetchInterval: (q) => (q.state.data?.isRunning ? 2000 : 60_000),
    retry: false,
  });
  const running = !!updater.data?.isRunning;
  const was = useRef(false);

  useEffect(() => {
    if (running) {
      was.current = true;
      return;
    }
    if (!was.current) return;
    was.current = false;
    const wasManual = manual;
    manual = false;
    void qc.invalidateQueries({ queryKey: ['library'] }).then(() => {
      const data = qc.getQueryData<LibraryManga[]>(['library']);
      const grew = data ? recordNewChapters(chapterCounts(data)) : 0;
      if (grew) toast(`${grew} title${grew === 1 ? '' : 's'} got new chapters: highlighted in your library`);
      else if (wasManual) toast('Update finished: no new chapters.');
      // A release also moves the volume lists: look for new volumes of the series that have one.
      if (data) void checkNewVolumes(data, wasManual);
    });
    void qc.invalidateQueries({ queryKey: ['updates'] });
  }, [running, qc]);

  // Scheduled run: every few minutes see whether one is due. One tab only (a Web Lock), only when the tab is visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible' || !due() || running) return;
      const go = async () => {
        if (!due()) return;
        try {
          localStorage.setItem(LAST_KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
        try {
          await startLibraryUpdate(qc);
        } catch {
          /* server unreachable: try again at the next due time */
        }
      };
      if (navigator.locks) void navigator.locks.request('mangadeck-autoupdate', { ifAvailable: true }, (lock) => (lock ? go() : undefined));
      else void go();
    };
    const first = setTimeout(tick, 15_000);
    const t = setInterval(tick, CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [qc, running]);
}
