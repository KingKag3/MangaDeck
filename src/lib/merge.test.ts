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
    expect(warnings.join(' ')).toMatch(/Volume 3 appears more than once/);
    expect(warnings.join(' ')).toMatch(/Missing volume 2/);
  });
  it('suggests a file name', () => {
    expect(suggestName('My: Series', [{ volume: 1 }, { volume: 2 }, { volume: 3 }])).toBe('My Series - Vols. 1-3.cbz');
    expect(suggestName('S', [{ volume: null }])).toBe('S - Merged.cbz');
  });
});
