import { describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../api/queries';

// Pretend the server: every chapter has two pages and each page's bytes say which chapter and page it is.
vi.mock('../api/queries', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/queries')>();
  return { ...real, M: { ...real.M, fetchPages: async (id: number) => [`/img/${id}/1`, `/img/${id}/2`] } };
});
vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>();
  return {
    ...real,
    resolveUrl: (u: string) => u,
    fetchBlob: async (u: string) => new Blob([`bytes of ${u}`], { type: 'image/jpeg' }),
  };
});

import { buildCbz } from './export';
import { chapterKeyOf, loadPart, mergeParts, sortParts } from './merge';
import { readContent, readZip } from './zipRead';

const chapter = (n: number) => ({ id: 1000 + n, chapterNumber: n }) as Chapter;
const items = (nums: number[], volumeOf: (n: number) => number | null) => nums.map((n) => ({ chapter: chapter(n), volume: volumeOf(n) }));
const asFile = (blob: Blob | null, name: string) => new File([blob!], name);

/** Chapters 1-3 are volume 1, 4-6 volume 2, anything later is not in a volume yet. */
const volumeOf = (n: number) => (n <= 3 ? 1 : n <= 6 ? 2 : null);

describe('download a complete .cbz, then append the chapters that came out later', () => {
  it('merges the new-chapters file into the complete one: chapters in order, pages intact, no repeats', async () => {
    // 1. The complete file, made while the series ended at chapter 5.
    const complete = await buildCbz({ series: 'Series', items: items([1, 2, 3, 4, 5], volumeOf) });
    expect(complete.pages).toBe(10);

    // 2. Later chapters 6 to 8 are out: export only those (what "Save the new chapters as .cbz" does).
    const tail = await buildCbz({ series: 'Series', items: items([6, 7, 8], volumeOf) });
    expect(tail.pages).toBe(6);

    // 3. Merge, as the "Add to it" button does.
    const parts = sortParts([await loadPart(asFile(tail.blob, 'Series - New chapters 6-8.cbz')), await loadPart(asFile(complete.blob, 'Series - Complete.cbz'))]);
    expect(parts.map((p) => p.file.name)).toEqual(['Series - Complete.cbz', 'Series - New chapters 6-8.cbz']);
    const merged = await mergeParts({ parts, series: 'Series' });
    expect(merged.skipped).toBe(0);
    expect(merged.pages).toBe(16);

    const entries = await readZip(merged.blob!);
    const pages = entries.filter((e) => e.name.endsWith('.jpg'));
    // Every chapter 1 to 8 appears, twice (two pages), in reading order.
    expect(pages.map((e) => chapterKeyOf(e.name))).toEqual([1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => Array(2).fill(`c000${n}`)));
    // The pages of the newest chapter are the ones the server gave, byte for byte.
    const last = pages[pages.length - 1];
    expect(new TextDecoder().decode(await readContent(merged.blob!, last))).toBe('bytes of /img/1008/2');
    // A ComicInfo.xml came along and names the series.
    const info = entries.find((e) => e.name === 'ComicInfo.xml');
    expect(new TextDecoder().decode(await readContent(merged.blob!, info!))).toContain('<Series>Series</Series>');
  });

  it('a new-chapters file that repeats chapters the complete file has adds nothing twice', async () => {
    const complete = await buildCbz({ series: 'Series', items: items([1, 2, 3, 4, 5], volumeOf) });
    // The new file starts one chapter too early (chapters 5 to 7).
    const tail = await buildCbz({ series: 'Series', items: items([5, 6, 7], volumeOf) });
    const parts = sortParts([await loadPart(asFile(tail.blob, 'Series - New chapters 5-7.cbz')), await loadPart(asFile(complete.blob, 'Series - Complete.cbz'))]);
    const merged = await mergeParts({ parts, series: 'Series' });
    expect(merged.skipped).toBe(2); // chapter 5, two pages
    const keys = (await readZip(merged.blob!)).filter((e) => e.name.endsWith('.jpg')).map((e) => chapterKeyOf(e.name));
    expect(new Set(keys).size).toBe(7);
    expect(keys.filter((k) => k === 'c0005')).toHaveLength(2);
  });

  it('chapters outside every volume still come last, and a second round of new chapters can be appended again', async () => {
    const complete = await buildCbz({ series: 'Series', items: items([1, 2, 3], volumeOf) });
    const first = await buildCbz({ series: 'Series', items: items([7, 8], volumeOf) }); // no volume yet
    const round1 = await mergeParts({
      parts: sortParts([await loadPart(asFile(first.blob, 'Series - New chapters 7-8.cbz')), await loadPart(asFile(complete.blob, 'Series - Complete.cbz'))]),
      series: 'Series',
    });
    const mergedFile = asFile(round1.blob, 'Series - Vols. 1.cbz');

    const second = await buildCbz({ series: 'Series', items: items([9, 10], volumeOf) });
    const round2 = await mergeParts({
      parts: sortParts([await loadPart(asFile(second.blob, 'Series - New chapters 9-10.cbz')), await loadPart(mergedFile)]),
      series: 'Series',
    });
    const keys = (await readZip(round2.blob!)).filter((e) => e.name.endsWith('.jpg')).map((e) => chapterKeyOf(e.name));
    expect([...new Set(keys)]).toEqual(['c0001', 'c0002', 'c0003', 'c0007', 'c0008', 'c0009', 'c0010']);
  });
});
