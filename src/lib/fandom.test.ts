import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupFandom, lookupVolumesEverywhere, plausibleRanges, wikiSlugs } from './fandom';

describe('wikiSlugs', () => {
  it('turns a title into wiki addresses', () => {
    expect(wikiSlugs(["Omniscient Reader's Viewpoint"])).toContain('omniscient-readers-viewpoint');
    expect(wikiSlugs(['Mob Psycho 100'])).toEqual(['mob-psycho-100', 'mobpsycho100']);
    expect(wikiSlugs(['The Boxer (manhwa)'])).toContain('boxer-manhwa');
  });
  it('drops names that are too short', () => {
    expect(wikiSlugs(['X'])).toEqual([]);
  });
});

describe('plausibleRanges', () => {
  const r = (volume: number, first: number, last: number) => ({ volume, first, last });
  it('accepts an ordered list', () => {
    expect(plausibleRanges([r(1, 0, 9), r(2, 10, 18), r(3, 19, 28)])).toBe(true);
  });
  it('accepts a chapter shared between two volumes', () => {
    expect(plausibleRanges([r(1, 1, 9), r(2, 9, 17)])).toBe(true);
  });
  it('rejects a single volume, overlaps, backwards ranges and duplicates', () => {
    expect(plausibleRanges([r(1, 1, 9)])).toBe(false);
    expect(plausibleRanges([r(1, 1, 20), r(2, 10, 30)])).toBe(false);
    expect(plausibleRanges([r(1, 9, 1), r(2, 10, 18)])).toBe(false);
    expect(plausibleRanges([r(1, 1, 9), r(1, 10, 18)])).toBe(false);
  });
});

const PAGE = [
  '== Volumes ==',
  '=== Volume 1 ===',
  '| chapters =',
  '* [[Chapter 1]]',
  '* [[Chapter 2]]',
  '* [[Chapter 9]]',
  '=== Volume 2 ===',
  '| chapters =',
  '* [[Chapter 10]]',
  '* [[Chapter 18]]',
  '=== Volume 3 ===',
  '| chapters =',
  '* [[Chapter 19]]',
  '* [[Chapter 28]]',
].join('\n');

/** A pretend internet: one wiki called "Test Series Wiki" with a Volumes page. */
function fakeFetch(opts: { wikiName?: string; page?: string } = {}) {
  const name = opts.wikiName ?? 'Test Series Wiki';
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
    if (url.startsWith('https://graphql.anilist.co')) return json({ data: { Page: { media: [] } } });
    if (!url.startsWith('https://test-series.fandom.com/')) throw new Error('no such wiki');
    if (url.includes('meta=siteinfo')) return json({ query: { general: { sitename: name } } });
    if (url.includes('list=search')) return json({ query: { search: [{ title: 'Volumes' }] } });
    if (url.includes('action=parse') && url.includes('page=Volumes')) return json({ parse: { title: 'Volumes', wikitext: { '*': opts.page ?? PAGE } } });
    return json({ error: { code: 'missingtitle' } });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('lookupFandom', () => {
  it('finds the wiki, reads its Volumes page and labels the result', async () => {
    vi.stubGlobal('fetch', fakeFetch());
    const info = await lookupFandom('Test Series');
    expect(info?.source).toBe('fandom');
    expect(info?.page).toBe('test-series: Volumes');
    expect(info?.ranges.map((x) => `${x.volume}:${x.first}-${x.last}`)).toEqual(['1:1-9', '2:10-18', '3:19-28']);
  });
  it('ignores a wiki that is about something else', async () => {
    vi.stubGlobal('fetch', fakeFetch({ wikiName: 'Completely Different Wiki' }));
    expect(await lookupFandom('Test Series')).toBeNull();
  });
  it('gives up quietly when the page has no volumes', async () => {
    vi.stubGlobal('fetch', fakeFetch({ page: 'Just some text about the series.' }));
    expect(await lookupFandom('Test Series')).toBeNull();
  });
  it('is only used after Wikipedia finds nothing', async () => {
    const f = fakeFetch();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('wikipedia.org')) return { ok: true, json: async () => ({ query: { search: [] }, error: { code: 'missingtitle' } }) } as Response;
        return f(input);
      }),
    );
    const info = await lookupVolumesEverywhere('Test Series');
    expect(info?.source).toBe('fandom');
  });
});

import { fuzzySlugs } from './fandom';

describe('fuzzySlugs', () => {
  it('shortens the title and adds common suffixes', () => {
    const s = fuzzySlugs(["Omniscient Reader's Viewpoint Webtoon"]);
    expect(s).toContain('omniscient-readers-viewpoint');
    expect(s).toContain('omniscient-readers');
    expect(s).toContain('omniscient-readers-viewpoint-webtoon-wiki');
  });
  it('skips short stems and slugs already tried', () => {
    expect(fuzzySlugs(['One Piece'], ['one-piece-wiki'])).not.toContain('one-piece-wiki');
    expect(fuzzySlugs(['The Boxer'])).not.toContain('the');
  });
});

describe('lookupFandom with a looser title', () => {
  it('finds the wiki from a longer title and still checks its name', async () => {
    vi.stubGlobal('fetch', fakeFetch());
    const info = await lookupFandom('Test Series Extra');
    expect(info?.page).toBe('test-series: Volumes');
  });
  it('does not accept a wiki whose name is much shorter than the title', async () => {
    vi.stubGlobal('fetch', fakeFetch());
    expect(await lookupFandom('Test Series Extra Long Subtitle Here')).toBeNull();
  });
});

describe('generic words in the title', () => {
  it('ignores "Manhwa" / "Webtoon" when comparing with the wiki name', async () => {
    vi.stubGlobal('fetch', fakeFetch());
    const info = await lookupFandom('Test Series Manhwa');
    expect(info?.page).toBe('test-series: Volumes');
  });
});
