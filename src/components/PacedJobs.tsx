import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Q } from '../api/queries';
import { chapterLabel } from '../lib/format';
import { cancelJob, clearFinishedJobs, formatDuration, pauseJob, removeFromJob, resumeJob, usePaceJobs, type PaceJob } from '../lib/pacer';

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

/** The chapters a job still has to do, so a failed one can be seen (and retried with Resume) instead of vanishing. */
function JobQueue({ job }: { job: PaceJob }) {
  const { data } = useQuery({ queryKey: ['chapters', job.mangaId], queryFn: () => Q.chapters(job.mangaId) });
  const byId = new Map((data ?? []).map((c) => [c.id, c]));
  const failedFirst = job.state === 'paused' && !job.current; // paused after repeated failures: the first one is the culprit
  if (job.queue.length === 0) return <div className="muted small job-queue">Nothing left in this job.</div>;
  return (
    <ul className="job-queue">
      {job.queue.map((cid, i) => {
        const c = byId.get(cid);
        const isCurrent = job.current === cid;
        const failed = failedFirst && i === 0 && !!job.note?.includes('failed');
        return (
          <li key={cid} className={failed ? 'jq-failed' : undefined}>
            <span className="grow">{c ? chapterLabel(c) : `Chapter #${cid}`}</span>
            <span className="muted small">{isCurrent ? 'Downloading…' : failed ? 'Failed · Resume retries it' : 'Waiting'}</span>
            {!isCurrent && (
              <button className="link-btn" onClick={() => removeFromJob(job.id, cid)} aria-label="Remove from this job">
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Bulk downloads that go one chapter at a time with a pause between, so sources do not ban you. */
export default function PacedJobs() {
  const jobs = usePaceJobs();
  const now = useNow(jobs.some((j) => j.state === 'running'));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
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
                {j.queue.length > 0 && (
                  <button className="btn ghost queue-toggle" onClick={() => toggle(j.id)} aria-expanded={open.has(j.id)}>
                    {open.has(j.id) ? '▾ Hide queue' : `▸ Show queue (${j.queue.length})`}
                  </button>
                )}
                {open.has(j.id) && <JobQueue job={j} />}
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
