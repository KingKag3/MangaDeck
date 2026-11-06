import { useSyncExternalStore } from 'react';
import { toast } from '../components/ui';
import { fetchBlob, isOffline, OFFLINE_EVENT, offlineSince, resolveUrl } from '../api/client';
import { M } from '../api/queries';
import { deleteSavedChapter, allSavedChapters, clearSavedChapters, putSavedChapter, getSavedPages, type SavedChapter } from './offlineDb';
import { getSettings } from './settings';
import { paceConfig, waitMs } from './pacer';
import { PENDING, readPending } from './offlineQueue';

export { pendingProgressCount, queueProgress } from './offlineQueue';

/** Cache Storage name for saved page images. The service worker (public/sw.js) answers page requests from it. */
export const PAGES_CACHE = 'mangadeck-offline-pages';

export type SavedMeta = Omit<SavedChapter, 'pages'> & { pageCount: number };

/* ---------- which chapters are saved (kept in memory so rows can show a mark instantly) ---------- */

let saved = new Map<number, SavedMeta>();
let snapshot: SavedMeta[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = [...saved.values()].sort((a, b) => a.mangaTitle.localeCompare(b.mangaTitle) || a.number - b.number);
  listeners.forEach((l) => l());
};
const strip = ({ pages, ...meta }: SavedChapter): SavedMeta => ({ ...meta, pageCount: pages.length });

export async function loadSaved() {
  saved = new Map((await allSavedChapters()).map((c) => [c.chapterId, strip(c)]));
  emit();
}
void loadSaved();

export function savedChapters(): SavedMeta[] {
  return snapshot;
}
export function isSaved(chapterId: number): boolean {
  return saved.has(chapterId);
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** Every chapter saved for offline reading, sorted by series then chapter. */
export function useSavedChapters(): SavedMeta[] {
  return useSyncExternalStore(subscribe, savedChapters);
}

/* ---------- saving and removing ---------- */

export interface SaveItem {
  id: number;
  mangaId: number;
  name: string;
  chapterNumber: number;
  isDownloaded: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(800 * (i + 1));
    }
  }
  throw last;
}

/** Download every page of one chapter into the cache and record it. */
export async function saveChapterOffline(c: SaveItem, mangaTitle: string, signal?: AbortSignal): Promise<void> {
  if (typeof caches === 'undefined') throw new Error('This browser cannot store pages for offline reading.');
  const pages = await withRetry(() => M.fetchPages(c.id), signal);
  if (!pages.length) throw new Error(`“${c.name}” has no pages.`);
  const cache = await caches.open(PAGES_CACHE);
  let bytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < pages.length) {
      const url = resolveUrl(pages[next++]);
      const blob = await withRetry(() => fetchBlob(url, signal), signal);
      bytes += blob.size;
      await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pages.length) }, worker));
  const rec: SavedChapter = { chapterId: c.id, mangaId: c.mangaId, mangaTitle, name: c.name, number: c.chapterNumber, pages, bytes, savedAt: Date.now() };
  await putSavedChapter(rec);
  saved.set(c.id, strip(rec));
  emit();
}

export async function removeSaved(chapterId: number): Promise<void> {
  const pages = await getSavedPages(chapterId);
  if (pages && typeof caches !== 'undefined') {
    const cache = await caches.open(PAGES_CACHE);
    await Promise.all(pages.map((p) => cache.delete(resolveUrl(p))));
  }
  await deleteSavedChapter(chapterId);
  saved.delete(chapterId);
  emit();
}

export async function removeAllSaved(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(PAGES_CACHE);
  await clearSavedChapters();
  saved = new Map();
  emit();
}

/* ---------- a save job (one at a time, one chapter after another) ---------- */

export interface SaveJob {
  running: boolean;
  title: string;
  total: number;
  done: number;
  failed: number;
  current: string;
  error: string;
}

let job: SaveJob = { running: false, title: '', total: 0, done: 0, failed: 0, current: '', error: '' };
let ctrl: AbortController | null = null;
const jobListeners = new Set<() => void>();
const setJob = (patch: Partial<SaveJob>) => {
  job = { ...job, ...patch };
  jobListeners.forEach((l) => l());
};
export function useSaveJob(): SaveJob {
  return useSyncExternalStore(
    (cb) => {
      jobListeners.add(cb);
      return () => jobListeners.delete(cb);
    },
    () => job,
  );
}
export function cancelSaving() {
  ctrl?.abort();
}

/** Save chapters for offline reading. Chapters the server has not downloaded wait between each other, as bulk downloads do. */
export async function startSaving(items: SaveItem[], mangaTitle: string, quiet = false): Promise<{ started: boolean; skipped: number }> {
  if (job.running) return { started: false, skipped: 0 };
  const todo = items.filter((c) => !saved.has(c.id));
  const skipped = items.length - todo.length;
  if (!todo.length) return { started: false, skipped };
  ctrl = new AbortController();
  const signal = ctrl.signal;
  setJob({ running: true, title: mangaTitle, total: todo.length, done: 0, failed: 0, current: '', error: '' });
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* only a request */
  }
  void (async () => {
    const cfg = paceConfig(getSettings());
    let live = 0;
    for (const c of todo) {
      if (signal.aborted) break;
      setJob({ current: c.name });
      try {
        await saveChapterOffline(c, mangaTitle, signal);
        setJob({ done: job.done + 1 });
      } catch (e) {
        if (signal.aborted) break;
        setJob({ failed: job.failed + 1, error: e instanceof Error ? e.message : String(e) });
      }
      if (!c.isDownloaded && c !== todo[todo.length - 1]) await sleep(waitMs(cfg, ++live));
    }
    setJob({ running: false, current: '' });
    if (quiet) return; // saving ahead while reading: no toasts, the progress bar is enough
    if (job.failed) toast(`${job.failed} chapter${job.failed === 1 ? '' : 's'} could not be saved: ${job.error}`, 'error');
    else if (job.done && !signal.aborted) toast(`Saved ${job.done} chapter${job.done === 1 ? '' : 's'} for offline reading`);
  })();
  return { started: true, skipped };
}

/* ---------- storage ---------- */

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

/* ---------- reading progress made while the server was out of reach ---------- */

/** Send queued progress to the server; what still fails stays queued. Returns how many were sent. */
export async function flushProgress(): Promise<number> {
  const all = readPending();
  let sent = 0;
  for (const [id, patch] of Object.entries(all)) {
    try {
      await M.updateChapter(Number(id), patch, { queue: false });
      delete all[id];
      sent++;
    } catch {
      break; // still unreachable: try again later
    }
  }
  try {
    if (Object.keys(all).length) localStorage.setItem(PENDING, JSON.stringify(all));
    else localStorage.removeItem(PENDING);
  } catch {
    /* ignore */
  }
  return sent;
}

/* ---------- is the server reachable? ---------- */

export function useOfflineStatus(): { offline: boolean; since: number | null } {
  const offline = useSyncExternalStore(
    (cb) => {
      window.addEventListener(OFFLINE_EVENT, cb);
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener(OFFLINE_EVENT, cb);
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => isOffline() || !navigator.onLine,
  );
  return { offline, since: offline ? offlineSince() : null };
}
