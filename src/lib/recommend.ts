import type { LibraryManga } from '../api/queries';

export interface Recommendation {
  id: number;
  title: string;
  cover: string;
  /** AniList average score, 0-100. */
  score: number | null;
  genres: string[];
  /** Library titles that led to this suggestion. */
  because: string[];
  /** Source of the first seed, used to link to a search in that source. */
  sourceId: string;
  siteUrl: string;
}

const ENDPOINT = 'https://graphql.anilist.co';
const SEEDS = 5;

export const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The library titles to base suggestions on: the ones read most recently (or the first few if nothing was read). */
export function pickSeeds(library: LibraryManga[], n = SEEDS): LibraryManga[] {
  const read = library
    .filter((m) => Number(m.lastReadChapter?.lastReadAt ?? 0) > 0)
    .sort((a, b) => Number(b.lastReadChapter!.lastReadAt) - Number(a.lastReadChapter!.lastReadAt));
  return (read.length ? read : [...library].sort((a, b) => a.title.localeCompare(b.title))).slice(0, n);
}

interface AniNode {
  rating: number | null;
  mediaRecommendation: {
    id: number;
    title: { romaji: string | null; english: string | null };
    coverImage: { large: string | null };
    averageScore: number | null;
    genres: string[];
    siteUrl: string;
    format: string | null;
  } | null;
}

/**
 * Ask AniList what readers of the seed titles also like, merge the answers (votes add up when several seeds
 * point at the same title) and drop anything already in the library.
 */
export async function fetchRecommendations(seeds: LibraryManga[], library: LibraryManga[], limit = 14): Promise<Recommendation[]> {
  if (!seeds.length) return [];
  const fields = `id title{romaji english} coverImage{large} averageScore genres siteUrl format`;
  const query = `query(${seeds.map((_, i) => `$s${i}:String`).join(',')}){${seeds
    .map(
      (_, i) =>
        `m${i}:Media(search:$s${i},type:MANGA){recommendations(sort:RATING_DESC,perPage:12){nodes{rating mediaRecommendation{${fields}}}}}`,
    )
    .join(' ')}}`;
  const variables = Object.fromEntries(seeds.map((s, i) => [`s${i}`, s.title]));
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList responded ${res.status}`);
  const json = await res.json();
  const data = json.data as Record<string, { recommendations: { nodes: AniNode[] } } | null> | null;
  if (!data) throw new Error(json.errors?.[0]?.message ?? 'No data from AniList');

  const have = new Set(library.map((m) => normTitle(m.title)));
  const merged = new Map<number, Recommendation & { votes: number }>();
  seeds.forEach((seed, i) => {
    for (const n of data[`m${i}`]?.recommendations.nodes ?? []) {
      const r = n.mediaRecommendation;
      if (!r || (n.rating ?? 0) <= 0 || r.format === 'NOVEL') continue;
      const title = r.title.english || r.title.romaji || '';
      if (!title || have.has(normTitle(title)) || (r.title.romaji && have.has(normTitle(r.title.romaji)))) continue;
      const prev = merged.get(r.id);
      if (prev) {
        prev.votes += n.rating ?? 0;
        if (!prev.because.includes(seed.title)) prev.because.push(seed.title);
      } else {
        merged.set(r.id, {
          id: r.id,
          title,
          cover: r.coverImage.large ?? '',
          score: r.averageScore,
          genres: r.genres.slice(0, 3),
          because: [seed.title],
          sourceId: seed.sourceId,
          siteUrl: r.siteUrl,
          votes: n.rating ?? 0,
        });
      }
    }
  });
  // Suggestions backed by several seeds first, then by votes.
  return [...merged.values()]
    .sort((a, b) => b.because.length - a.because.length || b.votes - a.votes)
    .slice(0, limit)
    .map(({ votes: _votes, ...r }) => r);
}
