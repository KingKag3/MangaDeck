import { useSyncExternalStore } from 'react';
import type { Chapter } from '../api/queries';
import { buildCbz, canSaveToDisk, pickSaveFile, saveBlob, type PackMeta, type SaveHandle } from './export';
import { logDownload } from './history';
import { backoffMs, downloadOne, formatDuration, paceConfig, sleep, waitMs } from './pacer';
import { getSettings } from './settings';

/**
 * .cbz export jobs: download the chapters one at a time (paced, through Suwayomi), then pack them into one file.
 * Jobs are saved in this browser, run from anywhere in the app, show on the Downloads page and can be resumed.
 * A zip is written as one stream, so a failed pack starts the file again, but the downloaded chapters are kept.
 */

export interface ExportItem {
  id: number;
  chapterNumber: number;
  volume: number | null;
  /** "Chapter 12" etc., for the queue list. */
  label: string;
}

export interface ExportJob {
  id: string;
  mangaId: number;
  title: string;
  /** 0 = the whole series */
  volume: number;
  fileName: string;
  /** Every chapter of the file, in reading order. */
  items: ExportItem[];
  meta: PackMeta;
  /** Chapter ids still to download, in order. */
  todo: number[];
  /** Chapters that failed 3 times: set aside so the rest can go on, retried once at the end. */
  parked: number[];
  /** 1 = first pass; 2 = the set-aside chapters have had their second pass. */
  round: 1 | 2;
  /** Labels of chapters you chose to leave out of the file. */
  leftOut?: string[];
  phase: 'downloading' | 'packing';
  state: 'running' | 'paused' | 'done' | 'cancelled';
  /** Chapters downloaded (or skipped) so far, and chapters packed so far. */
  done: number;
  packed: number;
  note?: string;
  /** True when the browser needs you to pick where to save the file (it forgets that when the page reloads). */
  needsFile?: boolean;
  /** Chapter being downloaded right now. */
  current?: number;
  /** When the next chapter starts (ms since epoch) while waiting. */
  nextAt?: number;
  failStreak: number;
  createdAt: number;
}

const KEY = 'mangadeck.exportjobs';
const MAX_FAIL_STREAK = 3;
/** How long to let a source cool down before the set-aside chapters get their second pass. */
const RETRY_COOLDOWN_MS = 5 * 60_000;

function read(): ExportJob[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (JSON.parse(raw) as ExportJob[]).map((j) => ({ ...j, parked: j.parked ?? [], round: j.round ?? 1 }));
  } catch {
    /* ignore */
  }
  return [];
}

let jobs: ExportJob[] = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function write(next: ExportJob[]) {
  jobs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* ignore */
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    jobs = read();
    emit();
  });
}

function patch(id: string, p: Partial<ExportJob>) {
  write(jobs.map((j) => (j.id === id ? { ...j, ...p } : j)));
}

export function useExportJobs(): ExportJob[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => jobs,
  );
}

const aborts = new Map<string, AbortController>();
/** Where each job saves its file. Browsers only hand this out from a click, so it lives in memory only. */
const handles = new Map<string, SaveHandle>();

/** Start an export. Returns false when this series/volume is already being exported. */
export function startExportJob(o: {
  mangaId: number;
  title: string;
  volume: number;
  fileName: string;
  items: ExportItem[];
  todo: number[];
  meta: PackMeta;
  handle: SaveHandle | null;
}): { id: string; existing: boolean } {
  const dup = jobs.find((j) => j.mangaId === o.mangaId && j.volume === o.volume && (j.state === 'running' || j.state === 'paused'));
  if (dup) return { id: dup.id, existing: true };
  const job: ExportJob = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    mangaId: o.mangaId,
    title: o.title,
    volume: o.volume,
    fileName: o.fileName,
    items: o.items,
    meta: o.meta,
    todo: o.todo,
    parked: [],
    round: 1,
    phase: o.todo.length ? 'downloading' : 'packing',
    state: 'running',
    done: 0,
    packed: 0,
    failStreak: 0,
    createdAt: Date.now(),
  };
  if (o.handle) handles.set(job.id, o.handle);
  askToNotify();
  write([job, ...jobs]);
  return { id: job.id, existing: false };
}

/** Ask once (from the click that starts an export) so a finished file can ping you when the tab is in the background. */
function askToNotify() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

function notifyDone(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, icon: '/logo.png' });
    }
  } catch {
    /* ignore */
  }
}

export function pauseExport(id: string) {
  patch(id, { state: 'paused', nextAt: undefined, current: undefined, note: 'Paused' });
  aborts.get(id)?.abort();
}

/** True when every chapter has been tried and only the set-aside ones are left: the job waits for you. */
export function needsDecision(j: ExportJob): boolean {
  return j.state === 'paused' && j.phase === 'downloading' && j.todo.length === 0 && j.parked.length > 0;
}

/** Continue a paused job. When only set-aside chapters are left, this gives them another round. */
export function resumeExport(id: string) {
  const j = jobs.find((x) => x.id === id);
  const retry = j && needsDecision(j) ? { todo: j.parked, parked: [] as number[], round: 2 as const } : {};
  patch(id, { state: 'running', note: undefined, failStreak: 0, needsFile: false, ...retry });
}

export function cancelExport(id: string) {
  patch(id, { state: 'cancelled', nextAt: undefined, current: undefined, note: 'Cancelled' });
  aborts.get(id)?.abort();
  handles.delete(id);
}

/** Give up on the set-aside chapters and write the one file without them. */
export function packWithoutParked(id: string) {
  const j = jobs.find((x) => x.id === id);
  if (!j || j.parked.length === 0) return;
  const gone = new Set(j.parked);
  const leftOut = j.items.filter((i) => gone.has(i.id)).map((i) => i.label);
  patch(id, {
    items: j.items.filter((i) => !gone.has(i.id)),
    parked: [],
    leftOut: [...(j.leftOut ?? []), ...leftOut],
    phase: 'packing',
    state: 'running',
    note: undefined,
    failStreak: 0,
  });
}

/** Must be called straight from a click: asks where to save the file, then carries on. */
export async function chooseExportFile(id: string) {
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  const handle = await pickSaveFile(j.fileName);
  if (!handle) return;
  handles.set(id, handle);
  resumeExport(id);
}

export function clearFinishedExports() {
  write(jobs.filter((j) => j.state === 'running' || j.state === 'paused'));
}

async function waitFor(id: string, ms: number) {
  patch(id, { nextAt: Date.now() + ms });
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(500);
    if (jobs.find((j) => j.id === id)?.state !== 'running') break;
  }
  if (jobs.some((j) => j.id === id)) patch(id, { nextAt: undefined });
}

async function downloadStep(job: ExportJob) {
  const id = job.id;
  const next = job.todo[0];
  if (next === undefined) {
    if (job.parked.length > 0 && job.round === 1) {
      // Everything else is in. Cool down, then give the set-aside chapters their second pass.
      patch(id, { current: undefined, note: `Retrying ${job.parked.length} set-aside chapter${job.parked.length === 1 ? '' : 's'} soon` });
      await waitFor(id, RETRY_COOLDOWN_MS);
      const cur = jobs.find((j) => j.id === id);
      if (cur && cur.state === 'running') patch(id, { todo: cur.parked, parked: [], round: 2, note: undefined, failStreak: 0 });
      return;
    }
    if (job.parked.length > 0) {
      patch(id, {
        state: 'paused',
        current: undefined,
        nextAt: undefined,
        note: `${job.parked.length} chapter${job.parked.length === 1 ? '' : 's'} could not be downloaded after retrying. Retry them, or write the file without them.`,
      });
      return;
    }
    patch(id, { phase: 'packing', current: undefined, nextAt: undefined, note: undefined });
    return;
  }
  const cfg = paceConfig(getSettings());
  const ac = new AbortController();
  aborts.set(id, ac);
  patch(id, { current: next, nextAt: undefined, note: undefined });
  let result: 'ok' | 'failed' = 'failed';
  try {
    result = await downloadOne(next, ac.signal);
  } catch {
    if (ac.signal.aborted) return; // paused or cancelled: the state is already set
  } finally {
    aborts.delete(id);
  }
  const cur = jobs.find((j) => j.id === id);
  if (!cur || cur.state !== 'running') return;
  if (result === 'ok') {
    const todo = cur.todo.slice(1);
    const done = cur.done + 1;
    patch(id, { todo, done, failStreak: 0, current: undefined });
    if (todo.length === 0) patch(id, { phase: 'packing' });
    else await waitFor(id, waitMs(cfg, done));
    return;
  }
  const failStreak = cur.failStreak + 1;
  if (failStreak >= MAX_FAIL_STREAK) {
    // Set this chapter aside and keep going with the rest; it gets another go at the end.
    patch(id, {
      todo: cur.todo.slice(1),
      parked: [...cur.parked, next],
      failStreak: 0,
      current: undefined,
      note: `A chapter failed ${MAX_FAIL_STREAK} times and was set aside. Carrying on with the rest; it is retried at the end.`,
    });
    await waitFor(id, waitMs(cfg, cur.done + 1));
    return;
  }
  const wait = backoffMs(failStreak);
  patch(id, { failStreak, current: undefined, note: `Download failed. Trying again in ${formatDuration(wait)}.` });
  await waitFor(id, wait);
}

async function packStep(job: ExportJob) {
  const id = job.id;
  const handle = handles.get(id) ?? null;
  if (canSaveToDisk && !handle) {
    patch(id, { state: 'paused', needsFile: true, note: 'All chapters are downloaded. Choose where to save the file to finish.' });
    return;
  }
  const ac = new AbortController();
  aborts.set(id, ac);
  patch(id, { packed: 0, note: undefined });
  const writable = handle ? await handle.createWritable() : null;
  try {
    const { blob, pages } = await buildCbz({
      series: job.title,
      items: job.items.map((i) => ({ chapter: { id: i.id, chapterNumber: i.chapterNumber } as Chapter, volume: i.volume })),
      volume: job.volume === 0 ? undefined : job.volume,
      meta: job.meta,
      sink: writable ? (part) => writable.write(part) : undefined,
      onProgress: (p) => patch(id, { packed: p.chapter }),
      signal: ac.signal,
    });
    if (writable) await writable.close();
    else if (blob) saveBlob(blob, job.fileName);
    handles.delete(id);
    notifyDone('Export finished', `${job.title}: ${job.fileName}`);
    patch(id, { state: 'done', packed: job.items.length, note: undefined });
    logDownload({
      kind: job.volume === 0 ? 'series' : 'volume',
      mangaId: job.mangaId,
      title: job.title,
      label: job.volume === 0 ? 'Complete series .cbz' : `Vol. ${String(job.volume).padStart(2, '0')} .cbz`,
      ok: true,
      note: `${job.items.length} chapters, ${pages} pages${job.leftOut?.length ? `. Left out: ${job.leftOut.join(', ')}` : ''}`,
      where: writable ? `${job.fileName} (where you chose to save it)` : `${job.fileName} in your browser's Downloads folder`,
    });
  } catch (e) {
    if (writable) await writable.abort().catch(() => undefined);
    if (ac.signal.aborted) return; // paused or cancelled
    patch(id, {
      state: 'paused',
      note: `Packing failed (${e instanceof Error ? e.message : 'unknown error'}). The downloaded chapters are kept. Resume starts the file again.`,
    });
  } finally {
    aborts.delete(id);
  }
}

let started = false;

/** Run the saved export jobs. Call once when the app starts; only one tab at a time does the work. */
export function startExporter() {
  if (started) return;
  started = true;
  const loop = async () => {
    for (;;) {
      jobs = read();
      const job = jobs.find((j) => j.state === 'running');
      if (!job) {
        await sleep(1000);
        continue;
      }
      try {
        if (job.phase === 'downloading') await downloadStep(job);
        else await packStep(job);
      } catch {
        await sleep(2000);
      }
    }
  };
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    void navigator.locks.request('mangadeck-exporter', loop);
  } else {
    void loop();
  }
}
