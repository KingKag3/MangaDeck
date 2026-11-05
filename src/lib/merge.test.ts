import { describe, expect, it } from 'vitest';
import { checkParts, loadPart, mergeParts, parseComicInfo, sortParts, suggestName, volumeFromName } from './merge';
import { ZipBuilder, crc32 } from './zip';
import { readContent, readZip } from './zipRead';

const enc = (s: string) => new TextEncoder().encode(s);

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A small .cbz: stored pages, or deflate pages when `packed`. */
async function makeCbz(name: string, pages: string[], info: string | null, packed = false): Promise<File> {
  const z = new ZipBuilder();
  for (const [i, p] of pages.entries()) {
    const data = enc(p.repeat(50));
    if (packed) await z.addRaw(`${i + 1}.jpg`, await deflate(data), { method: 8, crc: crc32(data), size: data.length });
    else await z.add(`${i + 1}.jpg`, data);
  }
  if (info) await z.add('ComicInfo.xml', enc(info));
  const blob = (await z.finish())!;
  return new File([blob], name);
}

const info = (vol: number, series = 'Test') => `<ComicInfo><Series>${series}</Series><Volume>${vol}</Volume><Writer>A &amp; B</Writer></ComicInfo>`;

describe('zip reading', () => {
  it('lists and reads back what ZipBuilder wrote', async () => {
    const f = await makeCbz('a.cbz', ['x', 'y'], null);
    const entries = await readZip(f);
    expect(entries.map((e) => e.name)).toEqual(['1.jpg', '2.jpg']);
    expect(new TextDecoder().decode(await readContent(f, entries[1]))).toBe('y'.repeat(50));
  });
  it('reads deflate entries', async () => {
    const f = await makeCbz('a.cbz', ['x'], null, true);
    const [e] = await readZip(f);
    expect(e.method).toBe(8);
    expect(new TextDecoder().decode(await readContent(f, e))).toBe('x'.repeat(50));
  });
  it('rejects a file that is not a zip', async () => {
    await expect(readZip(new Blob([enc('not a zip file at all, just some text')]))).rejects.toThrow(/zip/);
  });
  it('reads ZIP64 archives', async () => {
    const z = new ZipBuilder(undefined, { big: 100, count: 2 });
    for (let i = 0; i < 4; i++) await z.add(`${i}.jpg`, enc('data'.repeat(20)));
    const blob = (await z.finish())!;
    const entries = await readZip(blob);
    expect(entries).toHaveLength(4);
    expect(new TextDecoder().decode(await readContent(blob, entries[3]))).toBe('data'.repeat(20));
  });
});

describe('metadata helpers', () => {
  it('reads ComicInfo fields and unescapes them', () => {
    const m = parseComicInfo(info(3));
    expect(m).toMatchObject({ series: 'Test', volume: 3, writer: 'A & B' });
  });
  it('finds a volume number in a file name', () => {
    expect(volumeFromName('Series - Vol. 03.cbz')).toBe(3);
    expect(volumeFromName('Series v12.cbz')).toBe(12);
    expect(volumeFromName('Series.cbz')).toBeUndefined();
  });
});

describe('merging', () => {
  it('copies pages in volume order, mixing stored and deflate sources', async () => {
    const v2 = await loadPart(await makeCbz('b.cbz', ['c', 'd'], info(2), true));
    const v1 = await loadPart(await makeCbz('a.cbz', ['a', 'b'], info(1)));
    const parts = sortParts([v2, v1]);
    expect(parts.map((p) => p.volume)).toEqual([1, 2]);
    const { blob, pages } = await mergeParts({ parts, series: 'Test' });
    expect(pages).toBe(4);
    const entries = await readZip(blob!);
    const names = entries.map((e) => e.name);
    expect(names.slice(0, 4)).toEqual(['001_00001_1.jpg', '001_00002_2.jpg', '002_00003_1.jpg', '002_00004_2.jpg']);
    const text = async (i: number) => new TextDecoder().decode(await readContent(blob!, entries[i]));
    expect((await text(0))[0]).toBe('a');
    expect((await text(3))[0]).toBe('d');
    const ci = parseComicInfo(await text(4));
    expect(ci.series).toBe('Test');
    expect(await text(4)).toContain('<PageCount>4</PageCount>');
    expect(await text(4)).toContain('Vols. 1–2');
  });
  it('rejects a cbz without images', async () => {
    const z = new ZipBuilder();
    await z.add('notes.txt', enc('hi'));
    await expect(loadPart(new File([(await z.finish())!], 'x.cbz'))).rejects.toThrow();
  });
  it('warns about gaps, duplicates and mixed series', async () => {
    const mk = async (n: string, v: number, s = 'Test') => loadPart(await makeCbz(n, ['x'], info(v, s)));
    const warnings = checkParts([await mk('a.cbz', 1), await mk('b.cbz', 3), await mk('c.cbz', 3, 'Other')]);
    expect(warnings.join(' ')).toMatch(/different series/);
    expect(warnings.join(' ')).toMatch(/Volume 3 is in more than one file/);
    expect(warnings.join(' ')).toMatch(/Missing volume 2/);
  });
  it('suggests a file name', () => {
    expect(suggestName('My: Series', [{ volume: 1 }, { volume: 2 }, { volume: 3 }])).toBe('My Series - Vols. 1-3.cbz');
    expect(suggestName('S', [{ volume: null }])).toBe('S - Merged.cbz');
  });
});

import { nameMatchesSeries, volumesInName } from './merge';

describe('file names', () => {
  it('reads the volumes a name covers', () => {
    expect(volumesInName('Series - Vol. 03.cbz')).toEqual([3]);
    expect(volumesInName('Series - Vols. 1-3.cbz')).toEqual([1, 2, 3]);
    expect(volumesInName('Series - Vols. 1, 3, 4.cbz')).toEqual([1, 3, 4]);
    expect(volumesInName('Series - Vol. 03 - Title.cbz')).toEqual([3]);
    expect(volumesInName('Series.cbz')).toEqual([]);
  });
  it('matches a series name loosely', () => {
    expect(nameMatchesSeries('Dandadan - Vol. 01.cbz', 'Dandadan')).toBe(true);
    expect(nameMatchesSeries('Kaiju No. 8 - Vol. 1.cbz', 'Kaiju No 8')).toBe(true);
    expect(nameMatchesSeries('Other - Vol. 1.cbz', 'Dandadan')).toBe(false);
  });
});

import { chapterKeyOf, pageVolumes } from './merge';

/** A .cbz in our own page naming: chapters per volume, e.g. { 1: [1, 2], 2: [3] }. */
async function ourCbz(name: string, volumes: Record<number, number[]>, extra: Record<string, string> = {}): Promise<File> {
  const z = new ZipBuilder();
  for (const [v, chapters] of Object.entries(volumes)) {
    for (const c of chapters) {
      for (const p of [1, 2]) {
        await z.add(`v${String(v).padStart(2, '0')}_c${String(c).padStart(4, '0')}_p00${p}.jpg`, enc(`v${v}c${c}p${p}`));
      }
    }
  }
  for (const [n, t] of Object.entries(extra)) await z.add(n, enc(t));
  return new File([(await z.finish())!], name);
}

describe('our own page names', () => {
  it('reads the volume and chapter back, also inside a merged name', () => {
    expect(pageVolumes(['v01_c0001_p001.jpg', 'v02_c0005_p001.jpg', 'vz_c0200_p001.jpg'])).toEqual([1, 2]);
    expect(chapterKeyOf('v26_c0201_p003.png')).toBe('c0201');
    expect(chapterKeyOf('001_00005_v01_c0005_5_p001.jpg')).toBe('c0005_5');
    expect(chapterKeyOf('page-12.jpg')).toBeNull();
  });
});

describe('adding new volumes to a complete file', () => {
  it('puts the complete file first, appends the new volumes and keeps one copy of each chapter', async () => {
    const complete = await loadPart(await ourCbz('Series - Complete.cbz', { 1: [1, 2], 2: [3, 4] }));
    const vol3 = await loadPart(await ourCbz('Series - Vol. 03.cbz', { 3: [5, 6] }));
    const vol2again = await loadPart(await ourCbz('Series - Vol. 02.cbz', { 2: [3, 4] }));
    expect(complete.covers).toEqual([1, 2]);
    expect(complete.volume).toBe(1);

    const parts = sortParts([vol3, vol2again, complete]);
    expect(parts.map((p) => p.file.name)).toEqual(['Series - Complete.cbz', 'Series - Vol. 02.cbz', 'Series - Vol. 03.cbz']);
    expect(checkParts(parts).join(' ')).toMatch(/Volume 2 is in more than one file/);

    const { blob, pages, skipped } = await mergeParts({ parts, series: 'Series' });
    expect(skipped).toBe(4); // volume 2's two chapters, two pages each, were already in the complete file
    expect(pages).toBe(12);
    const names = (await readZip(blob!)).map((e) => e.name);
    expect(names.filter((n) => n.endsWith('.jpg')).map((n) => chapterKeyOf(n))).toEqual(
      ['c0001', 'c0001', 'c0002', 'c0002', 'c0003', 'c0003', 'c0004', 'c0004', 'c0005', 'c0005', 'c0006', 'c0006'],
    );
    expect(suggestName('Series', parts)).toBe('Series - Vols. 1-3.cbz');
  });
  it('still works when the merged file is merged again', async () => {
    const first = await mergeParts({
      parts: [await loadPart(await ourCbz('a.cbz', { 1: [1] })), await loadPart(await ourCbz('b.cbz', { 2: [2] }))],
      series: 'S',
    });
    const merged = await loadPart(new File([first.blob!], 'S - Vols. 1-2.cbz'));
    expect(merged.covers).toEqual([1, 2]);
    const next = await loadPart(await ourCbz('c.cbz', { 2: [2], 3: [3] }));
    const again = await mergeParts({ parts: sortParts([next, merged]), series: 'S' });
    expect(again.skipped).toBe(2); // chapter 2 of the new file was already in the merged one
    expect(again.pages).toBe(6);
  });
});
