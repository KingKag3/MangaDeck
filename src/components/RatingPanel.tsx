import { useQuery } from '@tanstack/react-query';
import { fetchRating } from '../lib/rating';

const fmt = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** AniList score and top reader reviews for a series. Quiet when AniList is unreachable or has no matching entry. */
export default function RatingPanel({ title }: { title: string }) {
  const q = useQuery({ queryKey: ['rating', title], queryFn: () => fetchRating(title), staleTime: 24 * 3600_000, retry: 1 });
  const r = q.data;
  if (!r || (r.score == null && r.reviews.length === 0)) return null;

  return (
    <details className="reader-override rating-panel">
      <summary>
        {r.score != null ? `★ ${r.score}/100` : 'Reviews'} on AniList
        <span className="muted small"> · {fmt(r.readers)} readers · {fmt(r.favourites)} favourites</span>
      </summary>
      {r.reviews.length === 0 ? (
        <p className="muted small pad-top">No written reviews yet.</p>
      ) : (
        <ul className="rating-reviews">
          {r.reviews.map((v) => (
            <li key={v.id}>
              <div className="small">
                {v.score != null && <strong>{v.score}/100 </strong>}
                <span className="muted">by {v.user}{v.votes ? ` · ${v.votes} votes` : ''}</span>
              </div>
              <p>{v.summary}</p>
              <a href={v.url} target="_blank" rel="noreferrer" className="small">
                Read the full review on AniList
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        <a href={r.url} target="_blank" rel="noreferrer">
          Open on AniList
        </a>{' '}
        · only the title is sent to AniList
      </p>
    </details>
  );
}
