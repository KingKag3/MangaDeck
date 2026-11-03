import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Recommendation } from '../lib/recommend';

/** Details of a recommended title: synopsis, why it was suggested, and where to find it. */
export default function RecDialog({ rec, onClose }: { rec: Recommendation; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rec-dialog" role="dialog" aria-modal="true" aria-label={rec.title}>
        <button className="rec-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="rec-dialog-body">
          <div className="cover rec-dialog-cover">{rec.cover && <img src={rec.cover} alt={rec.title} referrerPolicy="no-referrer" />}</div>
          <div className="rec-dialog-info">
            <h2>{rec.title}</h2>
            <div className="muted small">
              {[rec.score ? `★ ${(rec.score / 10).toFixed(1)}` : null, rec.year].filter(Boolean).join(' · ')}
            </div>
            {rec.genres.length > 0 && (
              <div className="chips">
                {rec.genres.map((g) => (
                  <span key={g} className="chip">
                    {g}
                  </span>
                ))}
              </div>
            )}
            <p className="rec-desc">{rec.description || 'No description available.'}</p>
            <div className="muted small">Because you read {rec.because.join(', ')}</div>
          </div>
        </div>
        <div className="row gap wrap rec-actions">
          <Link
            className="btn primary"
            to={`/browse/${encodeURIComponent(rec.sourceId)}?q=${encodeURIComponent(rec.title)}`}
            onClick={onClose}
          >
            Find in my source
          </Link>
          <a className="btn ghost" href={rec.siteUrl} target="_blank" rel="noreferrer">
            View on AniList
          </a>
        </div>
      </div>
    </div>
  );
}
