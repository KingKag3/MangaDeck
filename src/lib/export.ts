import { fetchBlob, resolveUrl } from '../api/client';
import { M, type Chapter } from '../api/queries';
import { ZipBuilder } from './zip';
import { downloadOne, paceConfig, waitMs } from './pacer';
import { getSettings } from './settings';

export interface ExportProgress {
  chapter: number; // chapters finished
  chapters: number;
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

/** Run `fn` over `items` with at most `limit` in flight, keeping results in order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Try `fn` up to `tries` times, waiting 2 s, 6 s, ... between attempts. Gateway timeouts and resets from a source are usually brief. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, tries = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted || attempt >= tries) throw e;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 2000 * (attempt * 2 - 1));
        signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
      });
    }
  }
}

export function safeFileName(s: string): string {
  return s.replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** What goes into ComicInfo.xml besides the page count. */
export interface PackMeta {
  author?: string | null;
  artist?: string | null;
  genre?: string[];
  summary?: string | null;
  web?: string | null;
  publisher?: string | null;
  /** YYYY-MM-DD */
  released?: string;
  isbn?: string;
  totalVolumes?: number;
  /** Chapter titles by chapter number. */
  titles?: Record<number, string>;
}

export interface PackOptions {
  series: string;
  /** Chapters in reading order. `volume` is null for chapters outside every volume. */
  items: { chapter: Chapter; volume: number | null }[];
  /** Set for a single-volume file (goes into ComicInfo.xml). */
  volume?: number;
  meta?: PackMeta;
  /** Receives bytes as they are produced (e.g. a file on disk) instead of building the archive in memory. */
  sink?: (part: Uint8Array) => Promise<void> | void;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/**
 * Pack the pages of chapters into one comic-book zip (.cbz) with a ComicInfo.xml, in reading order.
 * Pages are named v01_c0003_p004.jpg (vz_ for chapters outside any volume) so every reader sorts them right.
 * `blob` is null when a sink took the bytes.
 */
export async function buildCbz(o: PackOptions): Promise<{ blob: Blob | null; fileName: string; pages: number }> {
  const zip = new ZipBuilder(o.sink);
  let pages = 0;
  let done = 0;
  o.onProgress?.({ chapter: 0, chapters: o.items.length });

  for (const [ci, { chapter: c, volume }] of o.items.entries()) {
    o.signal?.throwIfAborted();
    const urls = await withRetry(() => M.fetchPages(c.id), o.signal);
    const blobs = await pool(urls, 4, (u) => withRetry(() => fetchBlob(resolveUrl(u), o.signal), o.signal));
    const vol = volume === null ? 'vz' : `v${String(volume).padStart(2, '0')}`;
    const tag = c.chapterNumber >= 0 ? String(Math.floor(c.chapterNumber)).padStart(4, '0') : `x${String(ci + 1).padStart(3, '0')}`;
    const frac = c.chapterNumber >= 0 && !Number.isInteger(c.chapterNumber) ? `_${String(c.chapterNumber).split('.')[1]}` : '';
    for (const [pi, b] of blobs.entries()) {
      const ext = EXT[b.type] ?? 'jpg';
      await zip.add(`${vol}_c${tag}${frac}_p${String(pi + 1).padStart(3, '0')}.${ext}`, new Uint8Array(await b.arrayBuffer()));
      pages++;
    }
    o.onProgress?.({ chapter: ++done, chapters: o.items.length });
  }

  await zip.add('ComicInfo.xml', new TextEncoder().encode(comicInfo(o, pages)));

  const name = o.volume !== undefined ? `${safeFileName(o.series)} - Vol. ${String(o.volume).padStart(2, '0')}` : `${safeFileName(o.series)} - Complete`;
  return { blob: await zip.finish(), fileName: `${name}.cbz`, pages };
}

/** ComicInfo.xml (the schema Komga, Kavita, Calibre and most comic readers read). */
export function comicInfo(o: Pick<PackOptions, 'series' | 'volume' | 'items' | 'meta'>, pages: number): string {
  const m = o.meta ?? {};
  const tags: [string, string | number | undefined | null][] = [];
  const title = o.volume !== undefined ? `${o.series} Vol. ${o.volume}` : o.series;
  tags.push(['Title', title], ['Series', o.series]);
  if (o.volume !== undefined) tags.push(['Number', o.volume], ['Volume', o.volume]);
  if (m.totalVolumes) tags.push(['Count', m.totalVolumes]);
  tags.push(['Summary', m.summary?.replace(/\*\*(.+?)\*\*/g, '$1').trim()]);
  if (m.released) {
    const [y, mo, d] = m.released.split('-');
    tags.push(['Year', Number(y)], ['Month', Number(mo)], ['Day', Number(d)]);
  }
  tags.push(['Writer', m.author], ['Penciller', m.artist && m.artist !== m.author ? m.artist : undefined]);
  tags.push(['Publisher', m.publisher], ['Genre', m.genre?.join(', ')], ['Web', m.web]);
  tags.push(['GTIN', m.isbn?.replace(/[^0-9Xx]/g, '')], ['PageCount', pages], ['LanguageISO', 'en'], ['Manga', 'YesAndRightToLeft']);
  const chapters = o.items
    .filter((i) => i.chapter.chapterNumber >= 0)
    .map((i) => {
      const n = i.chapter.chapterNumber;
      const t = m.titles?.[Math.floor(n)];
      return t ? `Ch. ${n}: ${t}` : `Ch. ${n}`;
    });
  if (chapters.length) tags.push(['Notes', `Chapters: ${chapters.join('; ')}. Packed by Mangadeck.`]);
  const body = tags
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `  <${k}>${xml(String(v))}</${k}>`)
    .join('\n');
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n` +
    `${body}\n</ComicInfo>\n`
  );
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------- Saving straight to disk (Chrome / Edge) ---------- */

export interface SaveHandle {
  /** File name the user chose. Browsers never reveal the full path. */
  name: string;
  createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

export const canSaveToDisk = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/** Ask where to save. Must be called from a click, before any long work. Resolves null if the user cancels. */
export async function pickSaveFile(fileName: string): Promise<SaveHandle | null> {
  try {
    return await (window as unknown as { showSaveFilePicker(o: unknown): Promise<SaveHandle> }).showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: 'Comic book archive', accept: { 'application/vnd.comicbook+zip': ['.cbz'] } }],
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/* ---------- Use Suwayomi's own download queue, politely ---------- */

/**
 * Download chapters through Suwayomi one at a time with the pause from Settings between them (so the source does
 * not see a flood), and wait until they are all on the server. Chapters the server gives up on are left to the
 * source fetch while packing. Cancelling removes the chapter in progress. Returns how many failed.
 */
export async function queueAndWait(
  ids: number[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const cfg = paceConfig(getSettings());
  let failed = 0;
  onProgress(0, ids.length);
  for (const [i, id] of ids.entries()) {
    signal?.throwIfAborted();
    if ((await downloadOne(id, signal)) === 'failed') failed++;
    onProgress(i + 1, ids.length);
    if (i < ids.length - 1) await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, waitMs(cfg, i + 1));
      signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
    });
  }
  return failed;
}

/* ---------- Saving several files into one folder (Chrome / Edge) ---------- */

interface FileHandleLike {
  createWritable(): Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  getFile(): Promise<{ size: number }>;
}

export interface FolderHandle {
  /** Folder name only; browsers never reveal the full path. */
  name: string;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  /** Everything in the folder (Chrome / Edge). */
  values?(): AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?(): Promise<File> }>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Ask which folder to save into. Must be called from a click. Resolves null if the user cancels. */
export async function pickFolder(): Promise<FolderHandle | null> {
  try {
    return await (window as unknown as { showDirectoryPicker(o: unknown): Promise<FolderHandle> }).showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** Size of a file in the folder, 0 when it is missing. */
export async function fileSizeIn(dir: FolderHandle, name: string): Promise<number> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size;
  } catch {
    return 0;
  }
}
