import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { M, Q, type LibraryManga } from '../api/queries';
import { Cover } from '../components/Cover';
import { Empty, ErrorBox, PageHeader, Spinner, errorToast, toast } from '../components/ui';
import { findDuplicates } from '../lib/duplicates';
import { timeAgo } from '../lib/format';

/** How much of the series you have read in this entry: the one to keep is usually the one with the most progress. */
const readCount = (m: LibraryManga) => Math.max(0, m.chapters.totalCount - m.unreadCount);

/** Library entries that look like the same series added from two sources. */
export default function DuplicatesPage() {
  const qc = useQueryClient();
  const lib = useQuery({ queryKey: ['library'], queryFn: Q.library });
  const groups = useMemo(() => findDuplicates(lib.data ?? []), [lib.data]);

  async function remove(m: LibraryManga) {
    if (!confirm(`Remove “${m.title}” (${m.source?.displayName ?? 'unknown source'}) from your library?\n\nDownloaded chapters stay on the server. You can add it again from Browse.`)) return;
    try {
      await M.setInLibrary(m.id, false);
      toast(`Removed ${m.title}`);
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (e) {
      errorToast(e);
    }
  }

  if (lib.isLoading) return <Spinner label="Looking through your library…" />;
  if (lib.error) return <ErrorBox error={lib.error} retry={() => lib.refetch()} />;

  return (
    <div className="page">
      <PageHeader title="Duplicate series">
        <Link className="btn ghost" to="/settings">
          Back to Settings
        </Link>
      </PageHeader>
      <p className="muted small">
        Entries whose titles match once case, accents, punctuation and notes like “(Official)” are ignored: the same series added from two sources. Sequels
        and spin-offs with a longer title are not matched. Nothing is removed unless you press Remove. To keep reading progress while switching source, open the
        series you want to keep and use <b>Other sources</b>, then <b>Move here</b>.
      </p>
      {groups.length === 0 ? (
        <Empty title="No duplicates found" hint="No two titles in your library look like the same series." />
      ) : (
        groups.map((g) => {
          const best = Math.max(...g.map(readCount));
          return (
            <section key={g[0].id} className="panel dup-group">
              <h2>{g[0].title}</h2>
              <div className="dup-row">
                {g.map((m) => (
                  <div key={m.id} className="dup-item">
                    <Link to={`/manga/${m.id}`}>
                      <Cover path={m.thumbnailUrl} alt={m.title} />
                    </Link>
                    <div className="dup-info">
                      <b title={m.title}>{m.title}</b>
                      <span className="muted small">{m.source?.displayName ?? 'Unknown source'}</span>
                      <span className="small">
                        {m.chapters.totalCount} chapters · {readCount(m)} read
                        {readCount(m) === best && best > 0 && g.length > 1 && <span className="chip"> most read</span>}
                      </span>
                      <span className="muted small">{m.lastReadChapter ? `read ${timeAgo(m.lastReadChapter.lastReadAt)}` : 'never read'}</span>
                      <div className="row gap">
                        <Link className="btn ghost" to={`/manga/${m.id}`}>
                          Open
                        </Link>
                        <button className="btn danger" onClick={() => void remove(m)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
