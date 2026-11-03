import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cancelJob, clearFinishedJobs, formatDuration, pauseJob, resumeJob, usePaceJobs, type PaceJob } from '../lib/pacer';

/** Ticks once a second while `active`, so countdowns move. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function status(job: PaceJob, now: number): string {
  if (job.state === 'done') return job.failed ? `Finished, ${job.failed} failed` : 'Finished';
  if (job.state === 'cancelled') return 'Cancelled';
  if (job.state === 'paused') return job.note ?? 'Paused';
  if (job.nextAt && job.nextAt > now) {
    const left = formatDuration(job.nextAt - now);
    return job.note ? `${job.note} (${left})` : `Waiting ${left} before the next chapter`;
  }
  return job.current ? 'Downloading a chapter…' : 'Starting…';
}

/** Bulk downloads that go one chapter at a time with a pause between, so sources do not ban you. */
export default function PacedJobs() {
  const jobs = usePaceJobs();
  const now = useNow(jobs.some((j) => j.state === 'running'));
  const visible = jobs.filter((j) => j.state !== 'cancelled');
  if (visible.length === 0) return null;
  const finished = visible.some((j) => j.state === 'done');

  return (
    <section className="paced">
      <div className="row gap paced-head">
        <h2>Paced downloads</h2>
        <span className="muted small">one chapter at a time, with a wait between</span>
        {finished && (
          <button className="link-btn paced-clear" onClick={clearFinishedJobs}>
            Clear finished
          </button>
        )}
      </div>
      <ul className="list">
        {visible.map((j) => {
          const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
          return (
            <li key={j.id} className="list-row paced-row">
              <div className="grow">
                <Link to={`/manga/${j.mangaId}`} className="row-title">
                  {j.title}
                </Link>
                <div className="muted small">
                  {j.done} of {j.total} chapters{j.failed ? ` · ${j.failed} failed` : ''}
                </div>
                <div className="progress" aria-label="progress">
                  <div className={`progress-bar ${j.state === 'paused' ? 'err' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="muted small">{status(j, now)}</div>
              </div>
              {j.state === 'running' && (
                <button className="btn ghost" onClick={() => pauseJob(j.id)}>
                  Pause
                </button>
              )}
              {j.state === 'paused' && (
                <button className="btn" onClick={() => resumeJob(j.id)}>
                  Resume
                </button>
              )}
              {(j.state === 'running' || j.state === 'paused') && (
                <button className="btn ghost" onClick={() => cancelJob(j.id)} aria-label="Cancel">
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
