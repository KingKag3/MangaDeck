import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { cancelSaving, flushProgress, pendingProgressCount, useOfflineStatus, useSaveJob } from '../lib/offline';
import { timeAgo } from '../lib/format';
import { toast } from './ui';

/**
 * Shown above every page: a notice while the server cannot be reached (what you see is the last saved copy; saved chapters still
 * open), and the progress of saving chapters for offline reading. Also sends queued reading progress once the server is back.
 */
export default function OfflineBar() {
  const qc = useQueryClient();
  const { offline, since } = useOfflineStatus();
  const job = useSaveJob();
  const was = useRef(offline);

  // Back online: refresh what was shown from the saved copy and send the progress made meanwhile.
  useEffect(() => {
    if (was.current && !offline) {
      qc.invalidateQueries();
      void flushProgress().then((n) => n > 0 && toast(`Sent reading progress for ${n} chapter${n === 1 ? '' : 's'}`));
    }
    was.current = offline;
  }, [offline, qc]);

  // At start and whenever the browser reports a connection, try to send anything queued earlier.
  useEffect(() => {
    const send = () => {
      if (pendingProgressCount() > 0) void flushProgress();
    };
    send();
    window.addEventListener('online', send);
    return () => window.removeEventListener('online', send);
  }, []);

  return (
    <>
      {offline && (
        <div className="offline-bar" role="status">
          <span>
            <b>Can't reach the server.</b> {since ? `Showing what was saved ${timeAgo(since)}. ` : ''}Chapters you saved for offline reading still open.
          </span>
          <Link to="/offline" className="link-btn">
            Offline library
          </Link>
        </div>
      )}
      {job.running && (
        <div className="offline-bar saving" role="status">
          <span>
            Saving “{job.title}” for offline reading: {job.done}/{job.total}
            {job.current ? ` · ${job.current}` : ''}
            {job.failed ? ` · ${job.failed} failed` : ''}
          </span>
          <button className="link-btn" onClick={cancelSaving}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
