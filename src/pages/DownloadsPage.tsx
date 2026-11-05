import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { M, Q } from '../api/queries';
import { Cover } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Spinner, errorToast } from '../components/ui';
import { chapterLabel } from '../lib/format';
import PacedJobs from '../components/PacedJobs';
import ExportJobs from '../components/ExportJobs';
import HistoryList from '../components/HistoryList';

export default function DownloadsPage() {
  const qc = useQueryClient();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['downloads'],
    queryFn: Q.downloads,
    refetchInterval: 2000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['downloads'] });
  const toggle = useMutation({
    mutationFn: () => (data?.state === 'STARTED' ? M.stopDownloader() : M.startDownloader()),
    onSuccess: refresh,
    onError: errorToast,
  });
  const clear = useMutation({ mutationFn: M.clearDownloader, onSuccess: refresh, onError: errorToast });
  const remove = useMutation({
    mutationFn: (id: number) => M.dequeueDownloads([id]),
    onSuccess: refresh,
    onError: errorToast,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;

  const queue = data?.queue ?? [];
  const running = data?.state === 'STARTED';

  return (
    <div className="page narrow">
      <PageHeader title="Downloads">
        <span className={`pill ${running ? 'ok' : 'idle'}`}>{running ? 'Running' : 'Paused'}</span>
        {/* Starting with an empty queue makes the server wait ~30s for nothing, so don't offer it. */}
        <button className="btn" onClick={() => toggle.mutate()} disabled={toggle.isPending || (!running && queue.length === 0)}>
          {toggle.isPending ? 'Working…' : running ? 'Pause' : 'Start'}
        </button>
        <button className="btn ghost" onClick={() => clear.mutate()} disabled={!queue.length || clear.isPending}>
          Clear queue
        </button>
      </PageHeader>

      <ExportJobs />
      <PacedJobs />

      {queue.length === 0 ? (
        <Empty title="Nothing in the queue" hint="Bulk downloads are listed above under Paced downloads (use Show queue to see each chapter). Single chapters show up here." />
      ) : (
        <ul className="list">
          {queue.map((d) => (
            <li key={d.chapter.id} className="list-row">
              <Link to={`/manga/${d.manga.id}`} className="thumb">
                <Cover path={d.manga.thumbnailUrl} alt={d.manga.title} />
              </Link>
              <div className="grow">
                <div className="row-title">{d.manga.title}</div>
                <div className="muted small">{chapterLabel(d.chapter)}</div>
                <div className="progress" aria-label="progress">
                  <div
                    className={`progress-bar ${d.state === 'ERROR' ? 'err' : ''}`}
                    style={{ width: `${Math.round(Math.min(1, d.progress) * 100)}%` }}
                  />
                </div>
                <div className="muted small">
                  {d.state === 'DOWNLOADING'
                    ? `${Math.round(d.progress * 100)}%`
                    : d.state === 'ERROR'
                      ? `Failed (tried ${d.tries}×)`
                      : 'Queued'}
                </div>
              </div>
              <button className="btn ghost" onClick={() => remove.mutate(d.chapter.id)} aria-label="Remove from queue">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <HistoryList />
    </div>
  );
}
