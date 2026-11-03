import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type UpdateChapter } from '../api/queries';
import { Cover } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Spinner, Tabs, errorToast, toast } from '../components/ui';
import { chapterLabel, dayBucket, timeAgo } from '../lib/format';

type Tab = 'updates' | 'history';

export default function UpdatesPage() {
  const [tab, setTab] = useState<Tab>('updates');
  const qc = useQueryClient();
  const nav = useNavigate();

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: [tab],
    queryFn: () => (tab === 'updates' ? Q.updates() : Q.history()),
  });

  const download = useMutation({
    mutationFn: (id: number) => M.enqueueDownloads([id]),
    onSuccess: () => {
      toast('Added to download queue');
      qc.invalidateQueries({ queryKey: ['downloads'] });
    },
    onError: errorToast,
  });

  const groups = useMemo(() => {
    const out: [string, UpdateChapter[]][] = [];
    for (const c of data ?? []) {
      const key = dayBucket(tab === 'updates' ? c.fetchedAt : c.lastReadAt);
      const last = out[out.length - 1];
      if (last && last[0] === key) last[1].push(c);
      else out.push([key, [c]]);
    }
    return out;
  }, [data, tab]);

  return (
    <div className="page narrow">
      <PageHeader title={tab === 'updates' ? 'Updates' : 'History'}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'updates', label: 'New chapters' },
            { value: 'history', label: 'Reading history' },
          ]}
        />
      </PageHeader>

      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {!isLoading && !error && groups.length === 0 && (
        <Empty
          title={tab === 'updates' ? 'No recent chapters' : 'Nothing read yet'}
          hint={tab === 'updates' ? 'Use “Check for updates” in the library to fetch new chapters.' : undefined}
        />
      )}

      {groups.map(([day, items]) => (
        <section key={day} className="day">
          <h3 className="day-title">{day}</h3>
          <ul className="list">
            {items.map((c) => (
              <li key={c.id} className={`list-row ${c.isRead ? 'is-read' : ''}`}>
                <Link to={`/manga/${c.manga.id}`} className="thumb">
                  <Cover path={c.manga.thumbnailUrl} alt={c.manga.title} />
                </Link>
                <button className="row-main" onClick={() => nav(`/read/${c.manga.id}/${c.id}`)}>
                  <div className="row-title">{c.manga.title}</div>
                  <div className="muted small">
                    {chapterLabel(c)}
                    {tab === 'history' && c.pageCount > 0 && ` · page ${Math.min(c.lastPageRead + 1, c.pageCount)}/${c.pageCount}`}
                    {' · '}
                    {timeAgo(tab === 'updates' ? c.fetchedAt : c.lastReadAt)}
                  </div>
                </button>
                {c.isDownloaded ? (
                  <span className="pill ok">Downloaded</span>
                ) : (
                  <button className="btn ghost" onClick={() => download.mutate(c.id)} aria-label="Download chapter">
                    ⬇
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
