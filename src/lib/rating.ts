import { normTitle } from './recommend';

/**
 * AniList score and reader reviews for a manga page. One search by title (title only is sent), the best match is taken only
 * when its name really matches, and the answer is kept in this browser for a week so pages open without a request.
 */

export interface Review {
  id: number;
  /** AniList's own one-line summary of the review (not the full text). */
  summary: string;
  /** The reviewer's score, 0-100. */
  score: number | null;
  /** How many readers found it helpful / voted on it. */
  votes: number;
  user: string;
  url: string;
}

export interface Rating {
  id: number;
  title: string;
  /** AniList average score, 0-100. */
  score: number | null;
  readers: number;
  favourites: number;
  url: string;
  reviews: Review[];
}

interface Candidate {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[] | null;
  format: string | null;
  averageScore: number | null;
  popularity: number | null;
  favourites: number | null;
  siteUrl: string;
  reviews?: { nodes: { id: number; summary: string | null; score: number | null; ratingAmount: number | null; user: { name: string } | null; siteUrl: string }[] } | null;
}

const ENDPOINT = 'https://graphql.anilist.co';
const KEY = 'mangadeck.ratings';
const DAY = 86_400_000;

/** The candidate whose name equals the title (any of its names), preferring the most read; null when nothing matches. */
export function pickMatch<T extends Pick<Candidate, 'title' | 'synonyms' | 'format' | 'popularity'>>(list: T[], title: string): T | null {
  const want = normTitle(title);
  if (!want) return null;
  const hits = list.filter((c) => {
    if (c.format === 'NOVEL') return false;
    const names = [c.title.english, c.title.romaji, c.title.native, ...(c.synonyms ?? [])];
    return names.some((n) => !!n && normTitle(n) === want);
  });
  return hits.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0] ?? null;
}

function toRating(c: Candidate): Rating {
  return {
    id: c.id,
    title: c.title.english || c.title.romaji || '',
    score: c.averageScore,
    readers: c.popularity ?? 0,
    favourites: c.favourites ?? 0,
    url: c.siteUrl,
    reviews: (c.reviews?.nodes ?? [])
      .filter((r) => r.summary)
      .map((r) => ({ id: r.id, summary: r.summary!.trim(), score: r.score, votes: r.ratingAmount ?? 0, user: r.user?.name ?? 'AniList user', url: r.siteUrl })),
  };
}

type Cache = Record<string, { at: number; rating: Rating | null }>;

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Cache;
  } catch {
    return {};
  }
}

/** True when the answer for this title is already in this browser (no request needed). */
export function hasCachedRating(title: string): boolean {
  const hit = readCache()[normTitle(title)];
  return !!hit && Date.now() - hit.at < (hit.rating ? 7 * DAY : DAY);
}

/** The AniList rating for a title, or null when AniList has no entry that matches by name. Throws when AniList cannot be reached. */
export async function fetchRating(title: string): Promise<Rating | null> {
  const key = normTitle(title);
  const hit = readCache()[key];
  if (hit && Date.now() - hit.at < (hit.rating ? 7 * DAY : DAY)) return hit.rating;

  const fields = `id title{romaji english native} synonyms format averageScore popularity favourites siteUrl
    reviews(perPage:3,sort:RATING_DESC){nodes{id summary score ratingAmount user{name} siteUrl}}`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query($s:String){Page(perPage:10){media(search:$s,type:MANGA){${fields}}}}`,
      variables: { s: title },
    }),
  });
  if (!res.ok) throw new Error(`AniList responded ${res.status}`);
  const json = await res.json();
  const media = json?.data?.Page?.media as Candidate[] | undefined;
  if (!media) throw new Error(json.errors?.[0]?.message ?? 'No data from AniList');
  const best = pickMatch(media, title);
  const rating = best ? toRating(best) : null;
  try {
    const cache = readCache();
    cache[key] = { at: Date.now(), rating };
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
  return rating;
}
