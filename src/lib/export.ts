import { fetchBlob, resolveUrl } from '../api/client';
import { M, type Chapter } from '../api/queries';
import { ZipBuilder } from './zip';

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

export function safeFileName(s: string): string {
  return s.replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface PackOptions {
  series: string;
  /** Chapters in reading order. `volume` is null for chapters outside every volume. */
  items: { chapter: Chapter; volume: number | null }[];
  /** Set for a single-volume file (goes into ComicInfo.xml). */
  volume?: number;
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
    const urls = await M.fetchPages(c.id);
    const blobs = await pool(urls, 4, (u) => fetchBlob(resolveUrl(u), o.signal));
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

  const title = o.volume !== undefined ? `${o.series} Vol. ${o.volume}` : o.series;
  const info =
    `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n  <Series>${xml(o.series)}</Series>\n` +
    (o.volume !== undefined ? `  <Volume>${o.volume}</Volume>\n` : '') +
    `  <Title>${xml(title)}</Title>\n  <PageCount>${pages}</PageCount>\n` +
    `  <Manga>YesAndRightToLeft</Manga>\n</ComicInfo>\n`;
  await zip.add('ComicInfo.xml', new TextEncoder().encode(info));

  const name = o.volume !== undefined ? `${safeFileName(o.series)} - Vol. ${String(o.volume).padStart(2, '0')}` : `${safeFileName(o.series)} - Complete`;
  return { blob: await zip.finish(), fileName: `${name}.cbz`, pages };
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

interface SaveHandle {
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
