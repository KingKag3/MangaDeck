import { useState } from 'react';
import { useHistory } from '../lib/history';

/**
 * The .cbz files made for one series: when, whole series or which volume, and up to which chapter.
 * Read from the download history (this browser only), so files made before this panel existed show without a chapter.
 */
export default function ExportLog({
  mangaId,
  newestChapter,
  countAfter,
  onSaveNew,
}: {
  mangaId: number;
  newestChapter: number;
  /** How many chapters are numbered above this one. */
  countAfter: (n: number) => number;
  onSaveNew: (after: number) => void;
}) {
  const history = useHistory();
  const [all, setAll] = useState(false);
  const exports = history.filter((h) => h.mangaId === mangaId && h.kind !== 'chapter' && h.ok);
  if (exports.length === 0) return null;

  // The whole-series (or "new chapters") file that reaches furthest tells you whether anything newer has come out since.
  const series = exports.filter((h) => (h.kind === 'series' || h.fromChapter !== undefined) && h.lastChapter !== undefined && h.lastChapter >= 0);
  const furthest = series.reduce((hi, h) => Math.max(hi, h.lastChapter ?? -1), -1);
  const newer = furthest >= 0 && newestChapter > furthest ? Math.floor(newestChapter) - furthest : 0;

  const shown = all ? exports : exports.slice(0, 5);
  return (
    <div className="export-log">
      <h3 className="export-log-title">.cbz files you saved</h3>
      {newer > 0 && (
        <p className="small export-log-new">
          <span className="muted">
            Your latest file ends at Ch. {furthest}; the series is now at Ch. {Math.floor(newestChapter)} ({countAfter(furthest)} new).
          </span>{' '}
          <button className="btn ghost" onClick={() => onSaveNew(furthest)}>
            ⭳ Save the new chapters as .cbz
          </button>{' '}
          <span className="muted">Then merge it into your complete file under "Your .cbz files".</span>
        </p>
      )}
      <ul className="export-log-list">
        {shown.map((h) => (
          <li key={`${h.at}-${h.label}`}>
            <span className="export-log-what">{h.kind === 'series' ? 'All chapters' : h.fromChapter !== undefined ? `New chapters from ${h.fromChapter}` : h.label.replace(/ \.cbz$/, '')}</span>
            {h.lastChapter !== undefined && h.lastChapter >= 0 && <span> · up to Ch. {h.lastChapter}</span>}
            {h.chapterCount !== undefined && <span className="muted"> · {h.chapterCount} chapters</span>}
            <span className="muted"> · {new Date(h.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          </li>
        ))}
      </ul>
      {!all && exports.length > shown.length && (
        <button className="link-btn" onClick={() => setAll(true)}>
          Show all {exports.length}
        </button>
      )}
    </div>
  );
}
