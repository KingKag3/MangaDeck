import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { M, Q } from '../api/queries';
import { Cover } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Spinner, errorToast, toast } from '../components/ui';
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
  // A chapter the server gave up on (504 from the source, timeouts) stays in the queue as an error. Putting it back
  // resets its tries; the server picks up the pages it still needs.
  const retry = useMutation({
    mutationFn: async (ids: number[]) => {
      await M.dequeueDownloads(ids);
      await M.enqueueDownloads(ids);
      await M.startDownloader();
    },
    onSuccess: (_d, ids) => {
      toast(`Trying ${ids.length} chapter${ids.length === 1 ? '' : 's'} again`);
      refresh();
    },
    onError: errorToast,
  });
  const remove = useMutation({
    mutationFn: (id: number) => M.dequeueDownloads([id]),
    onSuccess: refresh,
    onError: errorToast,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={() => refetch()} />;

  const queue = data?.queue ?? [];
  const running = data?.state === 'STARTED';
  const failedIds = queue.filter((d) => d.state === 'ERROR').map((d) => d.chapter.id);

  return (
    <div className="page narrow">
      <PageHeader title="Downloads" />

      <ExportJobs />
      <PacedJobs />

      <section className="paced">
        <div className="row gap paced-head">
          <h2>Server queue</h2>
          <span className={`pill ${running ? 'ok' : 'idle'}`}>{running ? 'Running' : 'Idle'}</span>
          {/* Starting with an empty queue makes the server wait ~30s for nothing, so the buttons only show with something queued. */}
          {queue.length > 0 && (
            <span className="paced-clear row gap">
              <button className="btn" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
                {toggle.isPending ? 'Working…' : running ? 'Pause server queue' : 'Start server queue'}
              </button>
              {failedIds.length > 0 && (
                <button className="btn" onClick={() => retry.mutate(failedIds)} disabled={retry.isPending}>
                  Retry {failedIds.length} failed
                </button>
              )}
              <button className="btn ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>
                Clear server queue
              </button>
            </span>
          )}
        </div>
        <p className="muted small">
          Chapters Suwayomi is downloading right now. These buttons only control this list, not the exports or paced downloads above, which have their own buttons and start the downloader themselves.
        </p>
      </section>

      {queue.length === 0 ? (
        <Empty title="Nothing in the server queue" hint="Exports and paced downloads feed this list one chapter at a time, so it is empty between chapters." />
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
              {d.state === 'ERROR' && (
                <button className="btn" onClick={() => retry.mutate([d.chapter.id])} disabled={retry.isPending}>
                  Retry
                </button>
              )}
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
