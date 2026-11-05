import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDuration } from '../lib/pacer';
import {
  cancelExport,
  chooseExportFile,
  clearFinishedExports,
  needsDecision,
  packWithoutParked,
  pauseExport,
  resumeExport,
  useExportJobs,
  type ExportJob,
} from '../lib/exportJobs';
import { errorToast } from './ui';

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const what = (j: ExportJob) => (j.volume === 0 ? 'Whole series as one .cbz' : `Vol. ${String(j.volume).padStart(2, '0')} as one .cbz`);

function status(j: ExportJob, now: number): string {
  if (j.state === 'done') return 'Finished. The file was saved.';
  if (j.state === 'cancelled') return 'Cancelled';
  if (j.state === 'paused') return j.note ?? 'Paused';
  if (j.phase === 'packing') return `Packing the file: ${j.packed} of ${j.items.length} chapters`;
  if (j.nextAt && j.nextAt > now) {
    const left = formatDuration(j.nextAt - now);
    return j.note ? `${j.note} (${left})` : `Downloading: waiting ${left} before the next chapter`;
  }
  return j.current ? 'Downloading a chapter…' : 'Starting…';
}

function Queue({ job }: { job: ExportJob }) {
  const byId = new Map(job.items.map((i) => [i.id, i]));
  if (job.todo.length === 0 && job.parked.length === 0) return <div className="muted small job-queue">All chapters are downloaded.</div>;
  const label = (cid: number) => byId.get(cid)?.label ?? `Chapter #${cid}`;
  return (
    <ul className="job-queue">
      {job.parked.map((cid) => (
        <li key={`p${cid}`} className="jq-failed">
          <span className="grow">{label(cid)}</span>
          <span className="muted small">Set aside after failing · retried at the end</span>
        </li>
      ))}
      {job.todo.map((cid) => (
        <li key={cid}>
          <span className="grow">{label(cid)}</span>
          <span className="muted small">{job.current === cid ? 'Downloading…' : 'Waiting'}</span>
        </li>
      ))}
    </ul>
  );
}

/** .cbz exports in progress: download every chapter, then pack them into one file. Saved in this browser, resumable. */
export default function ExportJobs() {
  const jobs = useExportJobs();
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
        <h2>.cbz exports</h2>
        <span className="muted small">download every chapter, then pack them into one file</span>
        {finished && (
          <button className="link-btn paced-clear" onClick={clearFinishedExports}>
            Clear finished
          </button>
        )}
      </div>
      <ul className="list">
        {visible.map((j) => {
          const total = j.items.length || 1;
          const downloaded = total - j.todo.length - j.parked.length;
          const decide = needsDecision(j);
          const pct = Math.round(((j.phase === 'packing' || j.state === 'done' ? (j.state === 'done' ? total : j.packed) : downloaded) / total) * 100);
          return (
            <li key={j.id} className="list-row paced-row">
              <div className="grow">
                <Link to={`/manga/${j.mangaId}`} className="row-title">
                  {j.title}
                </Link>
                <div className="muted small">
                  {what(j)} · {j.phase === 'packing' || j.state === 'done' ? `all ${total} chapters downloaded` : `${downloaded} of ${total} chapters downloaded${j.parked.length ? ` · ${j.parked.length} set aside` : ''}`}
                </div>
                <div className="progress" aria-label="progress">
                  <div className={`progress-bar ${j.state === 'paused' ? 'err' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="muted small">{status(j, now)}</div>
                {j.phase === 'downloading' && j.todo.length + j.parked.length > 0 && j.state !== 'done' && (
                  <button className="btn ghost queue-toggle" onClick={() => toggle(j.id)} aria-expanded={open.has(j.id)}>
                    {open.has(j.id) ? '▾ Hide queue' : `▸ Show queue (${j.todo.length + j.parked.length})`}
                  </button>
                )}
                {open.has(j.id) && <Queue job={j} />}
              </div>
              {j.state === 'running' && (
                <button className="btn ghost" onClick={() => pauseExport(j.id)}>
                  Pause
                </button>
              )}
              {j.state === 'paused' && j.needsFile && (
                <button className="btn" onClick={() => chooseExportFile(j.id).catch(errorToast)}>
                  Choose file
                </button>
              )}
              {j.state === 'paused' && !j.needsFile && (
                <button className="btn" onClick={() => resumeExport(j.id)}>
                  {decide ? 'Retry' : 'Resume'}
                </button>
              )}
              {decide && (
                <button className="btn ghost" onClick={() => packWithoutParked(j.id)} title="Write the one file now, without the chapters that would not download">
                  Pack without them
                </button>
              )}
              {(j.state === 'running' || j.state === 'paused') && (
                <button className="btn ghost" onClick={() => cancelExport(j.id)} aria-label="Cancel">
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
