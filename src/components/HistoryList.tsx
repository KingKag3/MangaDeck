import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dayBucket, timeAgo } from '../lib/format';
import { clearHistory, useHistory } from '../lib/history';

const SHOWN = 30;

/** What finished downloading, newest first, grouped by day. Kept in this browser (see lib/history.ts). */
export default function HistoryList() {
  const entries = useHistory();
  const [all, setAll] = useState(false);
  if (entries.length === 0) return null;
  const shown = all ? entries : entries.slice(0, SHOWN);

  let lastDay = '';
  return (
    <section className="paced history">
      <div className="row gap paced-head">
        <h2>History</h2>
        <span className="muted small">{entries.length} finished, kept in this browser</span>
        <button className="link-btn paced-clear" onClick={() => confirm('Clear the download history? Downloaded files stay as they are.') && clearHistory()}>
          Clear history
        </button>
      </div>
      <ul className="list">
        {shown.map((h) => {
          const day = dayBucket(h.at);
          const header = day !== lastDay;
          lastDay = day;
          return (
            <li key={`${h.at}-${h.mangaId}-${h.label}`} className="history-item">
              {header && <div className="history-day muted small">{day}</div>}
              <div className="list-row history-row">
                <span className={`history-mark ${h.ok ? 'ok' : 'err'}`} aria-label={h.ok ? 'Finished' : 'Failed'}>
                  {h.ok ? '✓' : '✕'}
                </span>
                <div className="grow">
                  <Link to={`/manga/${h.mangaId}`} className="row-title">
                    {h.title}
                  </Link>
                  <div className="muted small">
                    {h.label}
                    {h.note ? ` · ${h.note}` : ''}
                  </div>
                </div>
                <span className="muted small">{timeAgo(h.at)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {!all && entries.length > SHOWN && (
        <button className="link-btn" onClick={() => setAll(true)}>
          Show all {entries.length}
        </button>
      )}
    </section>
  );
}
