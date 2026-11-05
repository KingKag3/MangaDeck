import { safeFileName } from './export';
import { ZipBuilder } from './zip';
import { readContent, readRaw, readZip, type ZipEntry } from './zipRead';

/**
 * Merge several .cbz files (typically volumes) into one. Pages are copied straight from each source archive without
 * being decompressed, so it is fast and needs little memory. A fresh ComicInfo.xml is written for the result.
 * Source files are only read, never changed.
 */

const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** What we take from a source's ComicInfo.xml. */
export interface ComicMeta {
  series?: string;
  volume?: number;
  writer?: string;
  penciller?: string;
  publisher?: string;
  genre?: string;
  summary?: string;
  web?: string;
  language?: string;
  manga?: string;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Reads the few ComicInfo.xml fields we use (a regex is enough: the format is flat). */
export function parseComicInfo(xml: string): ComicMeta {
  const tag = (name: string) => {
    const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    const v = m ? unxml(m[1]).trim() : '';
    return v || undefined;
  };
  const num = (v: string | undefined) => {
    const n = v === undefined ? NaN : Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return {
    series: tag('Series'),
    volume: num(tag('Volume')) ?? num(tag('Number')),
    writer: tag('Writer'),
    penciller: tag('Penciller'),
    publisher: tag('Publisher'),
    genre: tag('Genre'),
    summary: tag('Summary'),
    web: tag('Web'),
    language: tag('LanguageISO'),
    manga: tag('Manga'),
  };
}

/** "Vol. 03", "Volume 3", "v03" in a file name. */
export function volumeFromName(name: string): number | undefined {
  const m = name.match(/(?:\bvol(?:ume)?\.?\s*|\bv)0*(\d{1,3})(?!\d)/i);
  return m ? Number(m[1]) : undefined;
}

/** Volumes a file name covers: "Vol. 03" gives [3], "Vols. 1-5" gives 1 to 5, "Vols. 1, 3, 4" gives those three. */
export function volumesInName(name: string): number[] {
  const m = name.match(/\bvol(?:ume)?s?\.?\s*(\d[\d\s,\-–]*)/i);
  if (!m) {
    const v = volumeFromName(name);
    return v === undefined ? [] : [v];
  }
  const out: number[] = [];
  for (const t of m[1].matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
    const a = Number(t[1]);
    const b = t[2] ? Number(t[2]) : a;
    for (let v = a; v <= Math.min(b, a + 200); v++) out.push(v);
  }
  return [...new Set(out)];
}

/** Does this file name look like it belongs to the series? Compares letters and digits only. */
export function nameMatchesSeries(fileName: string, series: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const want = norm(series);
  return want === '' || norm(fileName).includes(want);
}

/**
 * Our own exports name pages v01_c0003_p004.jpg (vz_ outside any volume); a merged file keeps that at the end of each name.
 * These read the volume and the chapter back out, so a "complete" file knows which volumes it holds.
 */
const PAGE_NAME = /(?:^|[_/])(v(\d+)|vz)_c(\d{4})((?:_\d+)?)_p\d+\.\w+$/;

/** Volumes whose pages are in this list of entries (from our own page names). */
export function pageVolumes(names: string[]): number[] {
  const out = new Set<number>();
  for (const n of names) {
    const m = PAGE_NAME.exec(n);
    if (m && m[2] !== undefined) out.add(Number(m[2]));
  }
  return [...out].sort((a, b) => a - b);
}

/** "c0201" or "c0005_5": the chapter a page belongs to, whatever volume it is filed under. Null for other naming. */
export function chapterKeyOf(name: string): string | null {
  const m = PAGE_NAME.exec(name);
  return m ? 'c' + m[3] + m[4] : null;
}

export interface MergePart {
  file: File;
  /** Every volume this file holds (a complete-series file holds many). Empty when unknown. */
  covers: number[];
  /** Image pages in reading order. */
  pages: ZipEntry[];
  meta: ComicMeta;
  /** From ComicInfo.xml, else from the file name; null when neither says. */
  volume: number | null;
}

/** Open one .cbz and work out its pages and volume. Throws a readable message for files that cannot be merged. */
export async function loadPart(file: File): Promise<MergePart> {
  const entries = await readZip(file);
  const pages = entries.filter((e) => IMAGE.test(e.name) && !e.name.split('/').some((s) => s.startsWith('.') || s === '__MACOSX')).sort((a, b) => natural(a.name, b.name));
  if (pages.length === 0) throw new Error(`${file.name} has no page images in it.`);
  const bad = pages.find((e) => e.method !== 0 && e.method !== 8);
  if (bad) throw new Error(`${file.name} uses a compression method that cannot be copied safely.`);
  if (pages.some((e) => e.flags & 1)) throw new Error(`${file.name} is password protected.`);
  const info = entries.find((e) => e.name.toLowerCase() === 'comicinfo.xml');
  let meta: ComicMeta = {};
  if (info) {
    try {
      meta = parseComicInfo(new TextDecoder().decode(await readContent(file, info)));
    } catch {
      /* a broken ComicInfo.xml only costs us the metadata */
    }
  }
  const inPages = pageVolumes(pages.map((e) => e.name));
  const named = meta.volume ?? volumeFromName(file.name);
  const covers = inPages.length ? inPages : volumesInName(file.name).length ? volumesInName(file.name) : named !== undefined ? [named] : [];
  // A complete file sorts by its first volume, so the new volumes come after it.
  return { file, pages, meta, covers, volume: inPages.length > 1 ? inPages[0] : (named ?? inPages[0] ?? null) };
}

/** Volume order; files without a volume come last, in name order. */
export function sortParts<T extends { volume: number | null; file: { name: string } }>(parts: T[]): T[] {
  return [...parts].sort((a, b) => {
    if (a.volume !== null && b.volume !== null && a.volume !== b.volume) return a.volume - b.volume;
    if ((a.volume === null) !== (b.volume === null)) return a.volume === null ? 1 : -1;
    return natural(a.file.name, b.file.name);
  });
}

/** Things worth a look before merging. They never block the merge. */
type PartInfo = Pick<MergePart, 'volume' | 'meta' | 'file'> & { covers?: number[] };
const coversOf = (p: PartInfo): number[] => (p.covers?.length ? p.covers : p.volume !== null ? [p.volume] : []);

export function checkParts(parts: PartInfo[]): string[] {
  const out: string[] = [];
  const series = new Set(parts.map((p) => p.meta.series?.toLowerCase().trim()).filter(Boolean));
  if (series.size > 1) out.push('These files look like different series.');
  const seen = new Map<number, number>();
  for (const p of parts) for (const v of coversOf(p)) seen.set(v, (seen.get(v) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([v]) => v);
  if (dupes.length) out.push(`Volume ${dupes.join(', ')} is in more than one file. Pages of a chapter that an earlier file already has are skipped.`);
  const vols = [...seen.keys()].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let v = vols[0]; v <= vols[vols.length - 1]; v++) if (!seen.has(v)) gaps.push(v);
  if (gaps.length) out.push(`Missing volume${gaps.length === 1 ? '' : 's'} ${gaps.join(', ')}, between the first and last.`);
  const unknown = parts.filter((p) => coversOf(p).length === 0).length;
  if (unknown) out.push(`${unknown} file${unknown === 1 ? ' has' : 's have'} no volume number, so ${unknown === 1 ? 'it goes' : 'they go'} last. Use the arrows to move ${unknown === 1 ? 'it' : 'them'}.`);
  return out;
}

/** "1–5" for a run, "1, 3, 4" otherwise. */
function volumeLabel(vols: number[]): string {
  const v = [...new Set(vols)].sort((a, b) => a - b);
  if (v.length === 0) return '';
  const run = v.every((x, i) => i === 0 || x === v[i - 1] + 1);
  return v.length > 1 && run ? `${v[0]}–${v[v.length - 1]}` : v.join(', ');
}

export function suggestName(series: string, parts: Pick<MergePart, 'volume'>[] & { covers?: number[] }[]): string {
  const label = volumeLabel(parts.flatMap((p) => coversOf(p as PartInfo)));
  const base = safeFileName(series) || 'Merged';
  return `${base} - ${label ? `Vols. ${label.replace('–', '-')}` : 'Merged'}.cbz`;
}

export function mergedComicInfo(series: string, parts: PartInfo[], pages: number): string {
  const first = <K extends keyof ComicMeta>(k: K) => parts.map((p) => p.meta[k]).find((v) => v !== undefined);
  const label = volumeLabel(parts.flatMap(coversOf));
  const tags: [string, string | number | undefined][] = [
    ['Title', label ? `${series} Vols. ${label}` : series],
    ['Series', series],
    ['Summary', first('summary')],
    ['Writer', first('writer')],
    ['Penciller', first('penciller')],
    ['Publisher', first('publisher')],
    ['Genre', first('genre')],
    ['Web', first('web')],
    ['PageCount', pages],
    ['LanguageISO', first('language') ?? 'en'],
    ['Manga', first('manga') ?? 'YesAndRightToLeft'],
    ['Notes', `Merged from: ${parts.map((p) => p.file.name).join('; ')}. Merged by Mangadeck.`],
  ];
  const body = tags
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `  <${k}>${esc(String(v))}</${k}>`)
    .join('\n');
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n` +
    `${body}\n</ComicInfo>\n`
  );
}

export interface MergeOptions {
  parts: MergePart[];
  series: string;
  /** Receives bytes as they are produced (a file on disk). Without it the result is built in memory. */
  sink?: (part: Uint8Array) => Promise<void> | void;
  onProgress?: (p: { part: number; parts: number }) => void;
  signal?: AbortSignal;
}

/** Copy every page of every part, in order, into one archive. Pages are renamed 001_00001_original.jpg so any reader sorts them right. */
export async function mergeParts(o: MergeOptions): Promise<{ blob: Blob | null; pages: number; skipped: number }> {
  const zip = new ZipBuilder(o.sink);
  let pages = 0;
  let skipped = 0;
  // Chapters (by number) that earlier files already brought in: a new volume file that repeats them adds nothing.
  const have = new Set<string>();
  o.onProgress?.({ part: 0, parts: o.parts.length });
  for (const [pi, part] of o.parts.entries()) {
    const mine = new Set<string>();
    for (const e of part.pages) {
      o.signal?.throwIfAborted();
      const key = chapterKeyOf(e.name);
      if (key && have.has(key)) {
        skipped++;
        continue;
      }
      if (key) mine.add(key);
      const raw = await readRaw(part.file, e);
      const base = (e.name.split('/').pop() ?? 'page').replace(/[\\/:*?"<>|]+/g, '_');
      pages++;
      await zip.addRaw(`${String(pi + 1).padStart(3, '0')}_${String(pages).padStart(5, '0')}_${base}`, raw, { method: e.method, crc: e.crc, size: e.size });
    }
    for (const k of mine) have.add(k);
    o.onProgress?.({ part: pi + 1, parts: o.parts.length });
  }
  await zip.add('ComicInfo.xml', new TextEncoder().encode(mergedComicInfo(o.series, o.parts, pages)));
  return { blob: await zip.finish(), pages, skipped };
}
