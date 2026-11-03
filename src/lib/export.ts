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

/**
 * Pack the pages of `chapters` into one comic-book zip (.cbz) with a ComicInfo.xml, in reading order.
 * Pages are named v01_c0003_p004.jpg so every reader sorts them correctly.
 */
export async function buildVolumeCbz(
  series: string,
  volume: number,
  chapters: Chapter[],
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; fileName: string; pages: number }> {
  const zip = new ZipBuilder();
  const vol = String(volume).padStart(2, '0');
  let pages = 0;
  let done = 0;
  onProgress?.({ chapter: 0, chapters: chapters.length });

  for (const [ci, c] of chapters.entries()) {
    const urls = await M.fetchPages(c.id);
    const blobs = await pool(urls, 4, (u) => fetchBlob(resolveUrl(u), signal));
    const tag = c.chapterNumber >= 0 ? String(Math.floor(c.chapterNumber)).padStart(4, '0') : `x${String(ci + 1).padStart(3, '0')}`;
    const frac = c.chapterNumber >= 0 && !Number.isInteger(c.chapterNumber) ? `_${String(c.chapterNumber).split('.')[1]}` : '';
    for (const [pi, b] of blobs.entries()) {
      const ext = EXT[b.type] ?? 'jpg';
      zip.add(`v${vol}_c${tag}${frac}_p${String(pi + 1).padStart(3, '0')}.${ext}`, new Uint8Array(await b.arrayBuffer()));
      pages++;
    }
    onProgress?.({ chapter: ++done, chapters: chapters.length });
  }

  const info =
    `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n  <Series>${xml(series)}</Series>\n` +
    `  <Volume>${volume}</Volume>\n  <Title>${xml(`${series} Vol. ${volume}`)}</Title>\n  <PageCount>${pages}</PageCount>\n` +
    `  <Manga>YesAndRightToLeft</Manga>\n</ComicInfo>\n`;
  zip.add('ComicInfo.xml', new TextEncoder().encode(info));

  return { blob: zip.finish(), fileName: `${safeFileName(series)} - Vol. ${vol}.cbz`, pages };
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
