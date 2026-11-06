import { useEffect, useMemo, useState } from 'react';
import { fetchRating, hasCachedRating } from './rating';

/**
 * AniList average scores for the whole library, for sorting and filtering. Each title is one AniList search (title only is sent),
 * shared with the cache the series page uses, and spaced out to stay under AniList's request limit. A title with no exact
 * match on AniList has the score null.
 */
export function useLibraryScores(items: { id: number; title: string }[], enabled: boolean) {
  const [scores, setScores] = useState<Map<number, number | null>>(new Map());
  const [error, setError] = useState('');
  const key = useMemo(() => items.map((i) => `${i.id}:${i.title}`).join('|'), [items]);

  useEffect(() => {
    if (!enabled || !items.length) return;
    let stop = false;
    setError('');
    void (async () => {
      for (const it of items) {
        if (stop) return;
        const cached = hasCachedRating(it.title);
        try {
          const r = await fetchRating(it.title);
          if (stop) return;
          setScores((p) => (p.get(it.id) === (r?.score ?? null) && p.has(it.id) ? p : new Map(p).set(it.id, r?.score ?? null)));
        } catch (e) {
          if (!stop) setError(e instanceof Error ? e.message : String(e));
          return; // unreachable or rate limited: stop, the next visit carries on from the cache
        }
        if (!cached) await new Promise((r) => setTimeout(r, 700));
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return { scores, error, loaded: items.filter((i) => scores.has(i.id)).length };
}

/** Higher score first; titles without a score come last. */
export function byScore(a: number | null | undefined, b: number | null | undefined): number {
  return (b ?? -1) - (a ?? -1);
}
