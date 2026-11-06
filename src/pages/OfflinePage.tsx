import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, PageHeader, errorToast, toast } from '../components/ui';
import { pendingProgressCount, removeAllSaved, removeSaved, storageUsage, useOfflineStatus, useSaveJob, useSavedChapters, type SavedMeta } from '../lib/offline';

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${Math.max(0.1, n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)} MB`);

/** Chapters saved for offline reading: open them, see how much space they use, remove them. Works without the server. */
export default function OfflinePage() {
  const chapters = useSavedChapters();
  const { offline } = useOfflineStatus();
  const job = useSaveJob();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => {
    void storageUsage().then(setUsage);
  }, [chapters.length]);

  const bySeries = useMemo(() => {
    const m = new Map<number, { id: number; title: string; items: SavedMeta[] }>();
    for (const c of chapters) {
      const s = m.get(c.mangaId) ?? { id: c.mangaId, title: c.mangaTitle, items: [] };
      s.items.push(c);
      m.set(c.mangaId, s);
    }
    return [...m.values()];
  }, [chapters]);
  const total = chapters.reduce((n, c) => n + c.bytes, 0);
  const pending = pendingProgressCount();

  async function remove(ids: number[], label: string) {
    if (!confirm(`Remove ${label} from offline reading? The chapters stay on the server.`)) return;
    try {
      for (const id of ids) await removeSaved(id);
      toast('Removed');
    } catch (e) {
      errorToast(e);
    }
  }

  return (
    <div className="page narrow">
      <PageHeader title="Offline library">
        {chapters.length > 0 && (
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('Remove every chapter saved for offline reading?')) return;
              await removeAllSaved().catch(errorToast);
              toast('Removed everything');
            }}
          >
            Remove all
          </button>
        )}
      </PageHeader>
      <p className="muted small">
        Chapters saved on this device so you can read them when the server is out of reach. Save them from a series page (the ⤓ button on a chapter, or select
        chapters and press <b>Save offline</b>). {offline ? 'The server cannot be reached right now.' : ''}
      </p>
      <p className="small">
        {chapters.length} chapter{chapters.length === 1 ? '' : 's'} · {mb(total)}
        {usage ? ` · this app uses ${mb(usage.used)} of the ${mb(usage.quota)} the browser allows` : ''}
        {pending > 0 ? ` · reading progress for ${pending} chapter${pending === 1 ? '' : 's'} will be sent when the server is back` : ''}
        {job.running ? ` · saving ${job.done}/${job.total} now` : ''}
      </p>
      {bySeries.length === 0 ? (
        <Empty title="Nothing saved yet" hint="Open a series and save a few chapters for offline reading." />
      ) : (
        bySeries.map((s) => (
          <section key={s.id} className="panel">
            <div className="row gap wrap">
              <h2 className="grow">{s.title}</h2>
              <span className="muted small">
                {s.items.length} chapter{s.items.length === 1 ? '' : 's'} · {mb(s.items.reduce((n, c) => n + c.bytes, 0))}
              </span>
              <button className="link-btn" onClick={() => void remove(s.items.map((c) => c.chapterId), `all ${s.items.length} chapters of “${s.title}”`)}>
                Remove series
              </button>
            </div>
            <ul className="merge-list">
              {s.items.map((c) => (
                <li key={c.chapterId} className="row gap">
                  <Link className="grow merge-name" to={`/read/${c.mangaId}/${c.chapterId}`} title={c.name}>
                    {c.name}
                  </Link>
                  <span className="muted small">
                    {c.pageCount} pages · {mb(c.bytes)}
                  </span>
                  <button className="link-btn" onClick={() => void remove([c.chapterId], `“${c.name}”`)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
