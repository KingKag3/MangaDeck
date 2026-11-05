import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPopular } from './recommend';
import type { LibraryManga } from '../api/queries';

const media = (id: number, english: string | null, romaji: string, format = 'MANGA') => ({
  id,
  title: { english, romaji },
  coverImage: { large: `c${id}` },
  averageScore: 80,
  genres: ['Action'],
  siteUrl: `https://anilist.co/manga/${id}`,
  format,
  description: 'Text<br>more',
  startDate: { year: 2020 },
});

afterEach(() => vi.unstubAllGlobals());

describe('fetchPopular', () => {
  it('keeps trending order, numbers the places and drops owned titles and novels', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { Page: { media: [media(1, 'Nano Machine', 'Nano Machine'), media(2, 'One Piece', 'One Piece'), media(3, null, 'Some Novel', 'NOVEL'), media(4, 'Pick Me Up', 'Pick Me Up')] } } }) })));
    const lib = [{ title: 'One Piece' }] as LibraryManga[];
    const out = await fetchPopular(lib, 'src1');
    expect(out.map((r) => `${r.rank}:${r.title}`)).toEqual(['1:Nano Machine', '4:Pick Me Up']);
    expect(out[0]).toMatchObject({ because: [], sourceId: 'src1', description: 'Text\nmore' });
  });
  it('throws a readable error when AniList fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(fetchPopular([], 's')).rejects.toThrow(/AniList responded 500/);
  });
});
