import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from './Cover';
import { dayBucket, timeAgo } from '../lib/format';
import { clearExports, clearHistory, useHistory } from '../lib/history';

const SHOWN = 30;

/** What finished downloading, newest first, grouped by day. Kept in this browser (see lib/history.ts). */
export default function HistoryList() {
  const entries = useHistory();
  const [all, setAll] = useState(false);
  if (entries.length === 0) {
    return (
      <section className="paced history">
        <div className="row gap paced-head">
          <h2>History</h2>
        </div>
        <p className="muted small">Nothing yet. Chapters and .cbz files you download from now on are listed here, and stay after they leave the queue.</p>
      </section>
    );
  }
  const shown = all ? entries : entries.slice(0, SHOWN);

  let lastDay = '';
  return (
    <section className="paced history">
      <div className="row gap paced-head">
        <h2>History</h2>
        <span className="muted small">{entries.length} finished, kept in this browser</span>
        <span className="paced-clear row gap">
          {entries.some((e) => e.kind !== 'chapter') && (
            <button className="link-btn" onClick={() => confirm('Remove the .cbz exports from the history? Saved files and chapter entries stay as they are.') && clearExports()}>
              Clear exports
            </button>
          )}
          <button className="link-btn" onClick={() => confirm('Clear the download history? Downloaded files stay as they are.') && clearHistory()}>
            Clear history
          </button>
        </span>
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
                <Link to={`/manga/${h.mangaId}`} className="thumb history-cover" aria-hidden="true" tabIndex={-1}>
                  <Cover path={`/api/v1/manga/${h.mangaId}/thumbnail`} alt="" />
                </Link>
                <div className="grow">
                  <Link to={`/manga/${h.mangaId}`} className="row-title">
                    {h.title}
                  </Link>
                  <div className="muted small">
                    {h.label}
                    {h.note ? ` · ${h.note}` : ''}
                  </div>
                  {h.where && <div className="muted small history-where">Saved: {h.where}</div>}
                  {!h.ok && h.kind !== 'chapter' && (
                    <div className="small history-where">
                      Nothing was saved.{' '}
                      <Link to={`/manga/${h.mangaId}`} className="link-btn">
                        Open the series and press the .cbz button again
                      </Link>
                      ; chapters the server already downloaded are reused, so it picks up where it stopped.
                    </div>
                  )}
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
