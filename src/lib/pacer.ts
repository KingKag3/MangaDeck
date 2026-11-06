import { useSyncExternalStore } from 'react';
import { M, Q } from '../api/queries';
import { chapterLabel } from './format';
import { logDownload } from './history';
import { findAltChapter } from './sourceLinks';
import { getSettings } from './settings';

/* ---------- Timing (pure, so it can be tested) ---------- */

export interface PaceConfig {
  /** Seconds to wait after each chapter. */
  delay: number;
  /** Random spread, 0.3 = the wait varies by up to ±30%. */
  jitter: number;
  /** Take a longer break after every N chapters (0 = never). */
  breakEvery: number;
  /** Length of that longer break, in seconds. */
  breakSecs: number;
}

export type PacePreset = 'gentle' | 'normal' | 'fast' | 'custom';

export const PRESETS: Record<Exclude<PacePreset, 'custom'>, PaceConfig> = {
  gentle: { delay: 45, jitter: 0.3, breakEvery: 10, breakSecs: 180 },
  normal: { delay: 20, jitter: 0.3, breakEvery: 15, breakSecs: 120 },
  fast: { delay: 8, jitter: 0.3, breakEvery: 0, breakSecs: 0 },
};

export const PRESET_LABELS: Record<PacePreset, string> = {
  gentle: 'Gentle · 45 s, long break every 10',
  normal: 'Normal · 20 s, long break every 15',
  fast: 'Fast · 8 s',
  custom: 'Custom',
};

export function paceConfig(s: { pacePreset: PacePreset; paceCustom: PaceConfig }): PaceConfig {
  return s.pacePreset === 'custom' ? s.paceCustom : PRESETS[s.pacePreset];
}

/** How long to wait after `finished` chapters (1 = the first one just finished). */
export function waitMs(cfg: PaceConfig, finished: number, rnd: () => number = Math.random): number {
  const spread = 1 + (rnd() * 2 - 1) * cfg.jitter;
  const longBreak = cfg.breakEvery > 0 && finished > 0 && finished % cfg.breakEvery === 0;
  return Math.max(0, Math.round((longBreak ? cfg.breakSecs : cfg.delay) * 1000 * spread));
}

/** Wait after a failed chapter: 1 min, 2, 4, 8 … capped at 30 min. */
export function backoffMs(failures: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, failures - 1));
}

/** Rough time spent waiting (not downloading) for `n` chapters. */
export function estimateWaitMs(cfg: PaceConfig, n: number): number {
  const gaps = Math.max(0, n - 1);
  const breaks = cfg.breakEvery > 0 ? Math.floor(gaps / cfg.breakEvery) : 0;
  return (gaps - breaks) * cfg.delay * 1000 + breaks * cfg.breakSecs * 1000;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/* ---------- Downloading one chapter ---------- */

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/**
 * Put one chapter in Suwayomi's queue and wait until the server has it. Returns 'failed' when the server gives up
 * on it (3 tries) or it takes longer than 10 minutes. Aborting removes it from the queue again.
 */
/** Chapters whose download Mangadeck itself drives and logs (paced jobs, .cbz packing); the queue watcher skips them. */
export const handledIds = new Set<number>();

export async function downloadOne(id: number, signal?: AbortSignal, onSeen?: (label: string) => void): Promise<'ok' | 'failed'> {
  if (handledIds.size > 2000) handledIds.clear();
  handledIds.add(id);
  await M.enqueueDownloads([id]);
  await M.startDownloader(); // safe: the queue is not empty now
  const started = Date.now();
  try {
    for (;;) {
      await sleep(2000, signal);
      const { queue } = await Q.downloads();
      const item = queue.find((i) => i.chapter.id === id);
      if (item) onSeen?.(chapterLabel(item.chapter));
      if (!item) return 'ok';
      if ((item.state === 'ERROR' && item.tries >= 3) || Date.now() - started > 10 * 60_000) {
        await M.dequeueDownloads([id]).catch(() => undefined);
        return 'failed';
      }
    }
  } catch (e) {
    if (signal?.aborted) await M.dequeueDownloads([id]).catch(() => undefined);
    throw e;
  }
}

/* ---------- Paced jobs (saved in the browser, run one chapter at a time) ---------- */

export interface PaceJob {
  id: string;
  title: string;
  mangaId: number;
  /** Chapters still to do, in order. */
  queue: number[];
  total: number;
  done: number;
  failed: number;
  state: 'running' | 'paused' | 'done' | 'cancelled';
  note?: string;
  /** Chapter being downloaded right now. */
  current?: number;
  /** When the next chapter starts (ms since epoch) while waiting. */
  nextAt?: number;
  failStreak: number;
  createdAt: number;
}

const KEY = 'mangadeck.pacejobs';
const MAX_FAIL_STREAK = 3;

function read(): PaceJob[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PaceJob[];
  } catch {
    /* ignore */
  }
  return [];
}

let jobs: PaceJob[] = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function write(next: PaceJob[]) {
  jobs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* ignore */
  }
  emit();
}

// Another tab may be the one running the jobs: pick up its changes.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    jobs = read();
    emit();
  });
}

function patch(id: string, p: Partial<PaceJob>) {
  write(jobs.map((j) => (j.id === id ? { ...j, ...p } : j)));
}

export function getJobs(): PaceJob[] {
  return jobs;
}

export function usePaceJobs(): PaceJob[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => jobs,
  );
}

const aborts = new Map<string, AbortController>();

/** Start (or extend) a paced download of these chapters. Returns how many were new. */
export function startPacedJob(o: { title: string; mangaId: number; ids: number[] }): { job: PaceJob; added: number } {
  const ids = [...new Set(o.ids)];
  const existing = jobs.find((j) => j.mangaId === o.mangaId && (j.state === 'running' || j.state === 'paused'));
  if (existing) {
    const have = new Set(existing.queue);
    const fresh = ids.filter((id) => !have.has(id) && id !== existing.current);
    patch(existing.id, { queue: [...existing.queue, ...fresh], total: existing.total + fresh.length, state: 'running', note: undefined });
    return { job: jobs.find((j) => j.id === existing.id)!, added: fresh.length };
  }
  const job: PaceJob = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: o.title,
    mangaId: o.mangaId,
    queue: ids,
    total: ids.length,
    done: 0,
    failed: 0,
    state: 'running',
    failStreak: 0,
    createdAt: Date.now(),
  };
  write([job, ...jobs]);
  return { job, added: ids.length };
}

export function pauseJob(id: string) {
  patch(id, { state: 'paused', nextAt: undefined, current: undefined, note: 'Paused' });
  aborts.get(id)?.abort();
}

export function resumeJob(id: string) {
  patch(id, { state: 'running', note: undefined, failStreak: 0 });
}

export function cancelJob(id: string) {
  patch(id, { state: 'cancelled', nextAt: undefined, current: undefined, note: 'Cancelled' });
  aborts.get(id)?.abort();
}

/** Drop one chapter from a job's waiting list (not the one being downloaded right now). */
export function removeFromJob(id: string, chapterId: number) {
  const job = jobs.find((j) => j.id === id);
  if (!job || job.current === chapterId || !job.queue.includes(chapterId)) return;
  const queue = job.queue.filter((c) => c !== chapterId);
  patch(id, { queue, total: Math.max(job.done + job.failed, job.total - 1), state: queue.length === 0 && job.state !== 'running' ? 'done' : job.state });
}

export function clearFinishedJobs() {
  write(jobs.filter((j) => j.state === 'running' || j.state === 'paused'));
}

/** Wait until `ms` have passed, or the job stops running. Shows the countdown through `nextAt`. */
async function waitFor(id: string, ms: number) {
  patch(id, { nextAt: Date.now() + ms });
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(500);
    if (jobs.find((j) => j.id === id)?.state !== 'running') break;
  }
  if (jobs.some((j) => j.id === id)) patch(id, { nextAt: undefined });
}

async function step(id: string) {
  let job = jobs.find((j) => j.id === id);
  if (!job || job.state !== 'running') return;
  const next = job.queue[0];
  if (next === undefined) {
    patch(id, { state: 'done', nextAt: undefined, current: undefined, note: undefined });
    return;
  }
  const cfg = paceConfig(getSettings());
  const ac = new AbortController();
  aborts.set(id, ac);
  patch(id, { current: next, nextAt: undefined, note: undefined });
  let result: 'ok' | 'failed' = 'failed';
  let label = 'Chapter';
  try {
    result = await downloadOne(next, ac.signal, (l) => (label = l));
  } catch {
    if (ac.signal.aborted) return; // paused or cancelled: the state is already set
  } finally {
    aborts.delete(id);
  }

  job = jobs.find((j) => j.id === id);
  if (!job || job.state !== 'running') return;
  if (result === 'ok') {
    logDownload({ kind: 'chapter', mangaId: job.mangaId, title: job.title, label, ok: true });
    const done = job.done + 1;
    const queue = job.queue.slice(1);
    patch(id, { queue, done, failStreak: 0, current: undefined });
    if (queue.length === 0) patch(id, { state: 'done' });
    else await waitFor(id, waitMs(cfg, done));
  } else {
    const failStreak = job.failStreak + 1;
    if (failStreak >= MAX_FAIL_STREAK) {
      // This source keeps failing: try the same chapter number on a linked source before giving up.
      const alt = await tryLinkedSources(job.mangaId, next, ac.signal);
      job = jobs.find((j) => j.id === id);
      if (!job || job.state !== 'running') return;
      if (alt) {
        logDownload({ kind: 'chapter', mangaId: job.mangaId, title: job.title, label, ok: true, note: `from ${alt.source} (this source failed)` });
        const done = job.done + 1;
        const queue = job.queue.slice(1);
        patch(id, { queue, done, failStreak: 0, current: undefined });
        if (queue.length === 0) patch(id, { state: 'done' });
        else await waitFor(id, waitMs(cfg, done));
        return;
      }
      logDownload({ kind: 'chapter', mangaId: job.mangaId, title: job.title, label, ok: false, note: `failed ${MAX_FAIL_STREAK} times in a row` });
      patch(id, {
        state: 'paused',
        failStreak: 0,
        current: undefined,
        note: `Paused: chapter failed ${MAX_FAIL_STREAK} times in a row. The source may be blocking you. Resume to try again later.`,
      });
      return;
    }
    const wait = backoffMs(failStreak);
    patch(id, { failStreak, current: undefined, note: `Download failed. Trying again in ${formatDuration(wait)}.` });
    await waitFor(id, wait);
  }
}

/**
 * Download chapter `chapterId` of `mangaId` from one of the manga's linked sources instead (same chapter number).
 * Returns the source that had it, or null when no linked source could.
 */
export async function tryLinkedSources(mangaId: number, chapterId: number, signal: AbortSignal): Promise<{ source: string; chapterId: number } | null> {
  const links = getSettings().links[String(mangaId)] ?? [];
  if (links.length === 0) return null;
  try {
    const own = (await Q.chapters(mangaId)).find((c) => c.id === chapterId);
    if (!own || own.chapterNumber < 0) return null;
    for (const l of links) {
      if (!(await Q.manga(l.mangaId)).source) continue; // its source is gone: nothing can be downloaded from it
      const alt = findAltChapter(await Q.chapters(l.mangaId), own.chapterNumber);
      if (!alt) continue;
      if (alt.isDownloaded || (await downloadOne(alt.id, signal)) === 'ok') return { source: l.source, chapterId: alt.id };
    }
  } catch {
    /* aborted or the server is unreachable: treat as not found */
  }
  return null;
}

let started = false;

/** Run the saved jobs. Call once when the app starts; only one tab at a time does the work. */
export function startPacer() {
  if (started) return;
  started = true;
  const loop = async () => {
    for (;;) {
      jobs = read(); // another tab may have added or paused something
      const job = jobs.find((j) => j.state === 'running');
      if (!job) {
        await sleep(1000);
        continue;
      }
      try {
        await step(job.id);
      } catch {
        await sleep(2000);
      }
    }
  };
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    void navigator.locks.request('mangadeck-pacer', loop);
  } else {
    void loop();
  }
}
